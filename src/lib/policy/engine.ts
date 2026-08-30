import { formatINR } from "../money";
import type {
  Decision,
  Mandate,
  MoneyAction,
  Policy,
  PolicyCheck,
  ReasonCode,
  Sku,
  Verdict,
} from "../schemas";

/**
 * Deterministic policy engine.
 *
 * Pure function: no I/O, no clock, no model. The caller passes `now` (unix seconds)
 * and the set of nonces already consumed by a payment.
 *
 * Rules run in the order the spec lists them. A DENY from any rule wins outright.
 * Among the bounding rules (qty, cap, floor, discount) the first failure wins and
 * becomes the COUNTER. HIGH_VALUE_REVIEW (GATE) is only reached once every bound
 * passes — an owner's approval must never be able to lift a buyer's spend cap, so
 * an over-cap order is countered, never gated.
 */

export interface Totals {
  found: Sku[];
  missing: string[];
  /** Σ list price × qty across the listed SKUs */
  list_total_paise: number;
  units: number;
}

export function computeTotals(action: MoneyAction, catalog: Sku[]): Totals {
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const found: Sku[] = [];
  const missing: string[] = [];
  for (const id of action.sku_ids) {
    const sku = byId.get(id);
    if (sku) found.push(sku);
    else missing.push(id);
  }
  const unitSum = found.reduce((acc, s) => acc + s.price_paise, 0);
  return {
    found,
    missing,
    list_total_paise: unitSum * action.qty,
    units: found.length * action.qty,
  };
}

/** Smallest total the policy accepts for this basket: max(price floor, discount limit). */
export function effectiveFloorPaise(list_total_paise: number, policy: Policy): number {
  const floor = Math.ceil((list_total_paise * policy.price_floor_pct) / 100);
  const discountLimited = Math.ceil((list_total_paise * (100 - policy.max_discount_pct)) / 100);
  return Math.max(floor, discountLimited);
}

interface RuleOutcome {
  decision: Decision;
  reason_code: ReasonCode;
  human_reason: string;
  counter?: { max_total_paise: number; suggestion: string };
}

function normalise(list: string[]): Set<string> {
  return new Set(list.map((c) => c.trim().toLowerCase()));
}

export function evaluate(
  action: MoneyAction,
  mandate: Mandate,
  policy: Policy,
  catalog: Sku[],
  usedNonces: Set<string> | ReadonlyArray<string>,
  now: number,
): Verdict {
  const used = usedNonces instanceof Set ? usedNonces : new Set(usedNonces);
  const checks: PolicyCheck[] = [];
  const failures: RuleOutcome[] = [];

  const fail = (rule: string, detail: string, outcome: RuleOutcome) => {
    checks.push({ rule, result: "fail", detail });
    failures.push(outcome);
  };
  const pass = (rule: string, detail: string) => checks.push({ rule, result: "pass", detail });
  const skip = (rule: string, detail: string) => checks.push({ rule, result: "skip", detail });

  /* 1. mandate expiry ------------------------------------------------ */
  if (now >= mandate.exp) {
    fail("mandate_expiry", `now=${now} >= exp=${mandate.exp}`, {
      decision: "DENY",
      reason_code: "MANDATE_EXPIRED",
      human_reason: `The buyer's mandate expired at ${new Date(mandate.exp * 1000).toISOString()}. Ask for a fresh one.`,
    });
  } else {
    pass("mandate_expiry", `valid for ${mandate.exp - now}s more`);
  }

  /* 2. nonce replay --------------------------------------------------- */
  if (used.has(mandate.nonce)) {
    fail("mandate_replay", `nonce ${mandate.nonce.slice(0, 8)}… already consumed`, {
      decision: "DENY",
      reason_code: "MANDATE_REPLAY",
      human_reason: "This mandate was already used for a payment. Each mandate pays once.",
    });
  } else {
    pass("mandate_replay", "nonce unused");
  }

  /* 3. category scope ∩ allowlist ------------------------------------ */
  const totals = computeTotals(action, catalog);
  const scope = normalise(mandate.category_scope);
  const allowlist = normalise(policy.category_allowlist);
  const allowed = [...allowlist].filter((c) => scope.has(c));
  const offending = totals.found.filter((s) => !allowed.includes(s.category.trim().toLowerCase()));
  if (offending.length > 0) {
    const cats = [...new Set(offending.map((s) => s.category))].join(", ");
    fail("category_scope", `${cats} ∉ {${allowed.join(", ")}}`, {
      decision: "DENY",
      reason_code: "CATEGORY_OUT_OF_SCOPE",
      human_reason: `${offending[0].name} is ${cats} — this shop only sells ${allowed.join(" and ") || "nothing"} to AI buyers.`,
    });
  } else if (totals.found.length > 0) {
    pass("category_scope", `all items within {${allowed.join(", ")}}`);
  } else {
    skip("category_scope", "no resolvable SKUs");
  }

  /* 4. sku existence -------------------------------------------------- */
  if (totals.missing.length > 0) {
    fail("sku_exists", `unknown: ${totals.missing.join(", ")}`, {
      decision: "DENY",
      reason_code: "SKU_NOT_FOUND",
      human_reason: `${totals.missing[0]} is not in the catalog. Nothing to sell.`,
    });
  } else {
    pass("sku_exists", `${totals.found.length} SKU(s) resolved`);
  }

  const pricingPossible = totals.missing.length === 0 && totals.found.length > 0;
  const total = action.proposed_total_paise;

  /* 5. max order value ------------------------------------------------ */
  if (total > policy.max_order_value_paise) {
    fail("order_value_limit", `${total} > ${policy.max_order_value_paise}`, {
      decision: "DENY",
      reason_code: "ORDER_VALUE_LIMIT",
      human_reason: `${formatINR(total)} is above this shop's per-order limit of ${formatINR(policy.max_order_value_paise)}.`,
    });
  } else {
    pass("order_value_limit", `${total} <= ${policy.max_order_value_paise}`);
  }

  /* 6. quantity ------------------------------------------------------- */
  if (action.qty > policy.max_qty_per_order) {
    const unitSum = totals.found.reduce((acc, s) => acc + s.price_paise, 0);
    const maxTotal = unitSum * policy.max_qty_per_order;
    fail("qty_limit", `${action.qty} > ${policy.max_qty_per_order}`, {
      decision: "COUNTER",
      reason_code: "QTY_LIMIT",
      human_reason: `Max ${policy.max_qty_per_order} per order; ${action.qty} requested.`,
      counter: {
        max_total_paise: maxTotal,
        suggestion: `Take ${policy.max_qty_per_order} for ${formatINR(maxTotal)} — the rest can be a second order.`,
      },
    });
  } else {
    pass("qty_limit", `${action.qty} <= ${policy.max_qty_per_order}`);
  }

  /* 7. spend cap ------------------------------------------------------ */
  if (total > mandate.spend_cap_paise) {
    fail("spend_cap", `${total} > cap ${mandate.spend_cap_paise}`, {
      decision: "COUNTER",
      reason_code: "SPEND_CAP_EXCEEDED",
      human_reason: `${formatINR(total)} is over the buyer's ${formatINR(mandate.spend_cap_paise)} mandate.`,
      counter: {
        max_total_paise: mandate.spend_cap_paise,
        suggestion: `Anything up to ${formatINR(mandate.spend_cap_paise)} works within this mandate.`,
      },
    });
  } else {
    pass("spend_cap", `${total} <= cap ${mandate.spend_cap_paise}`);
  }

  /* 8. price floor ---------------------------------------------------- */
  if (pricingPossible) {
    const floorTotal = Math.ceil((totals.list_total_paise * policy.price_floor_pct) / 100);
    if (total < floorTotal) {
      const counterAt = effectiveFloorPaise(totals.list_total_paise, policy);
      fail("price_floor", `${total} < floor ${floorTotal} (${policy.price_floor_pct}% of ${totals.list_total_paise})`, {
        decision: "COUNTER",
        reason_code: "PRICE_FLOOR",
        human_reason: `${formatINR(total)} is below the shop's minimum of ${formatINR(counterAt)} for this basket.`,
        counter: {
          max_total_paise: counterAt,
          suggestion: `Best price is ${formatINR(counterAt)} — the shop protects ${policy.price_floor_pct}% of list.`,
        },
      });
    } else {
      pass("price_floor", `${total} >= floor ${floorTotal}`);
    }
  } else {
    skip("price_floor", "no priced basket");
  }

  /* 9. discount limit -------------------------------------------------- */
  if (pricingPossible) {
    const implied =
      totals.list_total_paise > 0 ? ((totals.list_total_paise - total) / totals.list_total_paise) * 100 : 0;
    const effectiveDiscount = Math.max(action.discount_pct, implied);
    const rounded = Math.round(effectiveDiscount * 100) / 100;
    if (rounded > policy.max_discount_pct) {
      const counterAt = effectiveFloorPaise(totals.list_total_paise, policy);
      fail("discount_limit", `${rounded}% > ${policy.max_discount_pct}%`, {
        decision: "COUNTER",
        reason_code: "DISCOUNT_LIMIT",
        human_reason: `${rounded}% off is more than the ${policy.max_discount_pct}% this shop allows.`,
        counter: {
          max_total_paise: counterAt,
          suggestion: `${policy.max_discount_pct}% is the most the shop can do — that's ${formatINR(counterAt)}.`,
        },
      });
    } else {
      pass("discount_limit", `${rounded}% <= ${policy.max_discount_pct}%`);
    }
  } else {
    skip("discount_limit", "no priced basket");
  }

  /* 10. high-value gate ----------------------------------------------- */
  if (total > policy.gate_above_paise) {
    fail("high_value_gate", `${total} > ${policy.gate_above_paise}`, {
      decision: "GATE",
      reason_code: "HIGH_VALUE_REVIEW",
      human_reason: `${formatINR(total)} is above ${formatINR(policy.gate_above_paise)} — the shop owner decides this one.`,
    });
  } else {
    pass("high_value_gate", `${total} <= ${policy.gate_above_paise}`);
  }

  /* resolve ------------------------------------------------------------ */
  const deny = failures.find((f) => f.decision === "DENY");
  const counter = failures.find((f) => f.decision === "COUNTER");
  const gate = failures.find((f) => f.decision === "GATE");
  const winner = deny ?? counter ?? gate;

  if (!winner) {
    return {
      decision: "ALLOW",
      reason_code: "OK",
      human_reason: `${formatINR(total)} is inside every rule — cap, floor, category and limits all pass.`,
      policy_checks: checks,
    };
  }

  return {
    decision: winner.decision,
    reason_code: winner.reason_code,
    human_reason: winner.human_reason,
    ...(winner.counter ? { counter: winner.counter } : {}),
    policy_checks: checks,
  };
}

export const SEVERITY: Record<Decision, number> = { ALLOW: 0, COUNTER: 1, GATE: 2, DENY: 3 };

export function isMoneyMoving(decision: Decision): boolean {
  return decision === "ALLOW";
}
