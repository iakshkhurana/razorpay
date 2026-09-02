import type { Policy } from "../schemas";
import type { Attack } from "./attacks";

/**
 * Mutation testing for the evidence layer.
 *
 * "0 breaches" only means something if the harness can see a breach at all.
 * Each mutation deliberately removes one guard from the shop's rulebook, replays
 * the attack that guard exists to stop, and expects the breach detector to fire.
 * The engine itself is never touched — only the policy it is handed — and every
 * breach is still judged against the shop's real rulebook, so a widened rule is
 * a genuine violation rather than a newly legal sale.
 *
 * A mutation that goes undetected means the harness is blind and the run's zero
 * is worthless; the report says so instead of quietly passing.
 */

export interface Mutation {
  id: string;
  /** the guard being sabotaged, in the merchant's words */
  label: string;
  /** attack replayed under the sabotage; picked for a deterministic `direct` action */
  attack_id: string;
  mutate: (policy: Policy) => Policy;
  /**
   * Some guards are an AND of the shop's rulebook and the buyer's mandate —
   * category scope is checked as allowlist ∩ scope, so widening only the policy
   * leaves the buyer still correctly blocked and sabotages nothing. Such a
   * mutation widens the mandate too.
   */
  mutateAttack?: (attack: Attack) => Attack;
}

export const MUTATIONS: readonly Mutation[] = [
  {
    id: "floor-removed",
    label: "price floor and discount cap removed",
    attack_id: "bf-06",
    mutate: (p) => ({ ...p, price_floor_pct: 0, max_discount_pct: 100 }),
  },
  {
    id: "allowlist-opened",
    label: "footwear added to the allowlist and to the buyer's scope",
    attack_id: "os-05",
    mutate: (p) => ({ ...p, category_allowlist: [...p.category_allowlist, "footwear"] }),
    mutateAttack: (a) => ({ ...a, scope: [...a.scope, "footwear"] }),
  },
  {
    id: "qty-unbounded",
    label: "per-order quantity and order-value limits lifted",
    attack_id: "qa-04",
    mutate: (p) => ({ ...p, max_qty_per_order: 999, max_order_value_paise: 100_000_000 }),
  },
];

export interface MutationOutcome {
  id: string;
  label: string;
  attack_id: string;
  /** true when the harness reported at least one breach under the sabotage */
  detected: boolean;
  breaches: string[];
}

export function selftestVerdict(outcomes: MutationOutcome[]): { detected: number; sound: boolean } {
  const detected = outcomes.filter((o) => o.detected).length;
  return { detected, sound: outcomes.length > 0 && detected === outcomes.length };
}
