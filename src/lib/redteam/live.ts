import { listSkus } from "../db";
import { listEntries } from "../ledger";
import { issueMandate, verifyMandateToken } from "../mandate";
import type { Decision, LedgerEntry } from "../schemas";
import { activePolicy, checkout, makeOffer, recordMandateIssued } from "../storefront";
import { ATTACKS, breachReasons, type Attack } from "../eval/attacks";
import { nowSeconds } from "../utils";

/**
 * The red team, pointed at the running shop.
 *
 * The scorecard asks a judge to trust a table. This lets them press a button and
 * watch the same attack get refused in real time, with the refusal landing in
 * the live ledger like any other money action. It shares the attack corpus and
 * the breach detector with `npm run eval` — the only difference is that this
 * runs against the app's own database and the wall clock.
 *
 * Only attacks with a deterministic `direct` basket are offered: they need no
 * model, always finish in one round, and none of them has to place and pay for a
 * real order first the way the replay setup does.
 */

export const LIVE_ATTACK_IDS = ["ov-05", "bf-06", "os-05", "qa-04", "ex-03", "pi-04"] as const;
export type LiveAttackId = (typeof LIVE_ATTACK_IDS)[number];

export function isLiveAttackId(value: string): value is LiveAttackId {
  return (LIVE_ATTACK_IDS as readonly string[]).includes(value);
}

export function liveAttacks(): Array<Pick<Attack, "id" | "category" | "description">> {
  return LIVE_ATTACK_IDS.flatMap((id) => {
    const a = ATTACKS.find((x) => x.id === id);
    return a ? [{ id: a.id, category: a.category, description: a.description }] : [];
  });
}

export interface LiveVerdictLine {
  action: string;
  decision: Decision | string;
  reason_code: string;
  human_reason: string;
  amount_paise: number;
  ledger_entry_id: string;
}

export interface LiveAttackResult {
  attack: { id: string; category: string; description: string };
  verdicts: LiveVerdictLine[];
  /** true when money moved against the shop's own rulebook — must never happen */
  breached: boolean;
  breach_detail: string[];
  expected_reason_codes: string[];
  caught: boolean;
}

function toLine(e: LedgerEntry): LiveVerdictLine {
  return {
    action: e.action,
    decision: e.verdict,
    reason_code: e.reason_code,
    human_reason: e.human_reason,
    amount_paise: e.amount_paise,
    ledger_entry_id: e.id,
  };
}

export async function runLiveAttack(id: LiveAttackId): Promise<LiveAttackResult | null> {
  const attack = ATTACKS.find((a) => a.id === id);
  if (!attack || !attack.direct) return null;

  const now = nowSeconds();
  const expired = attack.setup === "expired";
  const { token } = issueMandate({
    agent_id: "red-team-console",
    user_ref: "red-team@agentgate.demo",
    spend_cap_paise: attack.cap_paise,
    category_scope: [...attack.scope],
    ttl_seconds: expired ? 1 : 3600,
    now: expired ? now - 100 : now,
  });
  // An expired mandate cannot be verified, so read its claims at the moment it was valid.
  const verified = verifyMandateToken(token, expired ? now - 100 : now);
  if (!verified.ok) return null;
  const mandate = verified.claims;
  recordMandateIssued(mandate);

  const before = listEntries().length;
  const offered = makeOffer({
    mandate,
    sku_ids: attack.direct.sku_ids,
    qty: attack.direct.qty,
    discount_pct: attack.direct.discount_pct,
    proposed_total_paise: attack.direct.proposed_total_paise,
    actor: "buyer_agent",
    now,
  });
  const placed = await checkout({ mandate, offer_id: offered.offer.id, now });

  const written = listEntries()
    .slice(before)
    .filter((e) => e.action !== "mandate.issued");
  const policy = activePolicy();
  const catalog = listSkus();
  const breach_detail =
    placed.ok && placed.order
      ? breachReasons(placed.order, attack, policy, mandate, { catalog, now })
      : [];
  const codes = written.map((e) => e.reason_code);
  const expected = new Set(attack.expected_reason_codes);

  return {
    attack: { id: attack.id, category: attack.category, description: attack.description },
    verdicts: written.map(toLine),
    breached: breach_detail.length > 0,
    breach_detail,
    expected_reason_codes: [...attack.expected_reason_codes],
    caught: codes.some((c) => expected.has(c)) && breach_detail.length === 0,
  };
}
