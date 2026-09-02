import { describe, expect, it } from "vitest";
import type { Mandate, MoneyAction, Policy, Sku } from "../schemas";
import { computeTotals, effectiveFloorPaise, evaluate } from "./engine";

/**
 * Property-based cover for the policy engine.
 *
 * The unit tests check one case per rule. These check the two properties that
 * actually carry the product, across thousands of adversarially-shaped inputs:
 *
 *   1. SAFETY — an ALLOW means every bound holds. Not "the rule we thought of";
 *      every one, re-derived here from the inputs rather than from the engine.
 *   2. EXPLAINABILITY — every verdict, whatever it decides, carries a reason
 *      code, a human sentence and at least one policy check.
 *
 * Plus the two structural claims the design rests on: the engine is pure (it
 * mutates nothing it is handed) and deterministic (same inputs, same verdict).
 *
 * The generator is seeded, so a failure is reproducible from the printed case.
 */

const CASES = 5000;
const SEED = 20260902;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = ["handloom", "gifts", "footwear", "grocery"] as const;

function makeCatalog(rand: () => number): Sku[] {
  const n = 1 + Math.floor(rand() * 5);
  return Array.from({ length: n }, (_, i) => ({
    id: `sku_${i}`,
    name: `Item ${i}`,
    description: "generated",
    price_paise: 1 + Math.floor(rand() * 800000),
    stock: Math.floor(rand() * 20),
    tags: [],
    category: CATEGORIES[Math.floor(rand() * CATEGORIES.length)],
    image_emoji: "🧵",
  }));
}

function pickSome<T>(items: readonly T[], rand: () => number): T[] {
  const chosen = items.filter(() => rand() < 0.6);
  return chosen.length > 0 ? chosen : [items[Math.floor(rand() * items.length)]];
}

interface Case {
  action: MoneyAction;
  mandate: Mandate;
  policy: Policy;
  catalog: Sku[];
  nonces: string[];
  now: number;
}

/**
 * A request a well-behaved buyer would send: in-scope items, quantity inside the
 * limit, list price, a live mandate. The bounds are then set right at the
 * proposed total (sometimes one paise under it), so these cases pile up on the
 * boundary — where an off-by-one would either block a legitimate sale or let one
 * through.
 */
function makeFriendlyCase(rand: () => number): Case {
  const now = 1_800_000_000;
  const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
  const catalog = makeCatalog(rand).map((s) => ({ ...s, category }));
  const ids = catalog.filter(() => rand() < 0.7).map((s) => s.id);
  if (ids.length === 0) ids.push(catalog[0].id);

  const max_qty_per_order = 1 + Math.floor(rand() * 6);
  const qty = 1 + Math.floor(rand() * max_qty_per_order);
  const draft: MoneyAction = { type: "offer", sku_ids: ids, qty, proposed_total_paise: 0, discount_pct: 0 };
  const total = computeTotals(draft, catalog).list_total_paise;
  // right on the bound, or a paise below it
  const bound = (n: number) => (rand() < 0.5 ? n : Math.max(0, n - 1));

  return {
    action: { ...draft, proposed_total_paise: total },
    mandate: {
      agent_id: "prop-agent",
      user_ref: "prop@example.com",
      spend_cap_paise: Math.max(1, bound(total)),
      category_scope: [category],
      exp: now + 1 + Math.floor(rand() * 5000),
      nonce: "nonce_prop",
    },
    policy: {
      price_floor_pct: Math.floor(rand() * 101),
      max_discount_pct: Math.floor(rand() * 101),
      max_qty_per_order,
      max_order_value_paise: Math.max(1, bound(total)),
      category_allowlist: [category],
      gate_above_paise: bound(total),
      refund_policy: "7-day easy returns.",
    },
    catalog,
    nonces: [],
    now,
  };
}

function makeCase(rand: () => number): Case {
  if (rand() < 0.4) return makeFriendlyCase(rand);
  const catalog = makeCatalog(rand);
  const now = 1_800_000_000;
  const policy: Policy = {
    price_floor_pct: Math.floor(rand() * 101),
    max_discount_pct: Math.floor(rand() * 101),
    max_qty_per_order: 1 + Math.floor(rand() * 6),
    max_order_value_paise: 1 + Math.floor(rand() * 2_000_000),
    category_allowlist: pickSome(CATEGORIES, rand),
    gate_above_paise: Math.floor(rand() * 1_000_000),
    refund_policy: "7-day easy returns.",
  };
  const mandate: Mandate = {
    agent_id: "prop-agent",
    user_ref: "prop@example.com",
    spend_cap_paise: 1 + Math.floor(rand() * 1_500_000),
    category_scope: pickSome(CATEGORIES, rand),
    // a quarter of the cases are already expired
    exp: rand() < 0.25 ? now - Math.floor(rand() * 1000) : now + 1 + Math.floor(rand() * 5000),
    nonce: "nonce_prop",
  };
  // mostly real SKU ids, sometimes a ghost
  const ids = catalog.filter(() => rand() < 0.7).map((s) => s.id);
  if (ids.length === 0) ids.push(catalog[0].id);
  if (rand() < 0.15) ids.push("sku_ghost");

  const draft: MoneyAction = { type: "offer", sku_ids: ids, qty: 1, proposed_total_paise: 0, discount_pct: 0 };
  const listTotal = computeTotals(draft, catalog).list_total_paise;
  const qty = 1 + Math.floor(rand() * 8);
  const discount_pct = Math.floor(rand() * 101);
  // sometimes a coherent total, sometimes a haggle, sometimes nonsense
  const roll = rand();
  const proposed =
    roll < 0.4
      ? Math.round((listTotal * qty * (100 - discount_pct)) / 100)
      : roll < 0.8
        ? Math.floor(rand() * 2_000_000)
        : listTotal * qty;

  return {
    action: { type: rand() < 0.5 ? "offer" : "checkout", sku_ids: ids, qty, proposed_total_paise: proposed, discount_pct },
    mandate,
    policy,
    catalog,
    nonces: rand() < 0.15 ? [mandate.nonce] : [],
    now,
  };
}

/** The bounds, re-derived from the inputs — deliberately not reusing the engine's logic. */
function violations(c: Case): string[] {
  const bad: string[] = [];
  const totals = computeTotals(c.action, c.catalog);
  const total = c.action.proposed_total_paise;

  if (c.now >= c.mandate.exp) bad.push("expired");
  if (c.nonces.includes(c.mandate.nonce)) bad.push("replayed");
  if (totals.missing.length > 0) bad.push("unknown_sku");
  if (total > c.mandate.spend_cap_paise) bad.push("over_cap");
  if (total > c.policy.max_order_value_paise) bad.push("over_order_value");
  if (c.action.qty > c.policy.max_qty_per_order) bad.push("over_qty");
  if (total > c.policy.gate_above_paise) bad.push("above_gate");

  const allowed = new Set(c.policy.category_allowlist.map((x) => x.toLowerCase()));
  const scope = new Set(c.mandate.category_scope.map((x) => x.toLowerCase()));
  for (const sku of totals.found) {
    const cat = sku.category.toLowerCase();
    if (!allowed.has(cat) || !scope.has(cat)) bad.push(`out_of_scope:${cat}`);
  }

  if (totals.missing.length === 0 && totals.found.length > 0) {
    const floor = Math.ceil((totals.list_total_paise * c.policy.price_floor_pct) / 100);
    if (total < floor) bad.push("below_floor");
    const implied = totals.list_total_paise > 0 ? ((totals.list_total_paise - total) / totals.list_total_paise) * 100 : 0;
    const effective = Math.round(Math.max(c.action.discount_pct, implied) * 100) / 100;
    if (effective > c.policy.max_discount_pct) bad.push("over_discount");
  }
  return bad;
}

describe(`policy engine properties (${CASES} seeded cases)`, () => {
  it("an ALLOW means every bound holds, and every verdict explains itself", () => {
    const rand = mulberry32(SEED);
    let allows = 0;
    for (let i = 0; i < CASES; i += 1) {
      const c = makeCase(rand);
      const verdict = evaluate(c.action, c.mandate, c.policy, c.catalog, c.nonces, c.now);

      // explainability holds for every decision, without exception
      expect(verdict.human_reason.trim().length, `case ${i}: empty human_reason`).toBeGreaterThan(0);
      expect(verdict.policy_checks.length, `case ${i}: no policy checks`).toBeGreaterThan(0);
      expect(verdict.reason_code.length).toBeGreaterThan(0);

      if (verdict.decision === "ALLOW") {
        allows += 1;
        const bad = violations(c);
        expect(bad, `case ${i}: ALLOW despite ${bad.join(", ")} — ${JSON.stringify(c.action)}`).toEqual([]);
      }

      if (verdict.decision === "COUNTER") {
        expect(verdict.counter, `case ${i}: COUNTER without a counter offer`).toBeDefined();
        expect(verdict.counter?.max_total_paise).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(verdict.counter?.max_total_paise)).toBe(true);
      }
    }
    // the generator must actually reach ALLOW, or the property proves nothing
    expect(allows).toBeGreaterThan(50);
  });

  it("an expired or replayed mandate is always denied, whatever else is wrong", () => {
    const rand = mulberry32(SEED + 1);
    let checked = 0;
    for (let i = 0; i < CASES; i += 1) {
      const c = makeCase(rand);
      const expired = c.now >= c.mandate.exp;
      const replayed = c.nonces.includes(c.mandate.nonce);
      if (!expired && !replayed) continue;
      checked += 1;
      const verdict = evaluate(c.action, c.mandate, c.policy, c.catalog, c.nonces, c.now);
      expect(verdict.decision, `case ${i}: expired/replayed mandate not denied`).toBe("DENY");
      expect(["MANDATE_EXPIRED", "MANDATE_REPLAY"]).toContain(verdict.reason_code);
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("is pure and deterministic: same inputs, same verdict, nothing mutated", () => {
    const rand = mulberry32(SEED + 2);
    for (let i = 0; i < 500; i += 1) {
      const c = makeCase(rand);
      const snapshot = JSON.stringify([c.action, c.mandate, c.policy, c.catalog, c.nonces]);
      const first = evaluate(c.action, c.mandate, c.policy, c.catalog, c.nonces, c.now);
      const second = evaluate(c.action, c.mandate, c.policy, c.catalog, c.nonces, c.now);
      expect(second, `case ${i}: not deterministic`).toEqual(first);
      expect(JSON.stringify([c.action, c.mandate, c.policy, c.catalog, c.nonces]), `case ${i}: inputs mutated`).toBe(snapshot);
    }
  });

  it("never counters above the bound it is enforcing", () => {
    const rand = mulberry32(SEED + 3);
    let counters = 0;
    for (let i = 0; i < CASES; i += 1) {
      const c = makeCase(rand);
      const verdict = evaluate(c.action, c.mandate, c.policy, c.catalog, c.nonces, c.now);
      if (verdict.decision !== "COUNTER" || !verdict.counter) continue;
      counters += 1;
      const totals = computeTotals(c.action, c.catalog);
      const ceiling =
        verdict.reason_code === "SPEND_CAP_EXCEEDED"
          ? c.mandate.spend_cap_paise
          : verdict.reason_code === "PRICE_FLOOR" || verdict.reason_code === "DISCOUNT_LIMIT"
            ? effectiveFloorPaise(totals.list_total_paise, c.policy)
            : null;
      if (ceiling !== null) {
        expect(verdict.counter.max_total_paise, `case ${i}: counter above its own bound`).toBeLessThanOrEqual(ceiling);
      }
    }
    expect(counters).toBeGreaterThan(100);
  });
});
