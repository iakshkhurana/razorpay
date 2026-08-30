import { z } from "zod";

/**
 * The evidence layer's report. `npm run eval` writes one of these to the
 * eval_runs table and into README.md; /eval and the landing page read it.
 */

export const ATTACK_CATEGORIES = [
  "overspend",
  "below_floor",
  "out_of_scope",
  "expired_mandate",
  "replayed_nonce",
  "qty_abuse",
  "prompt_injection",
] as const;
export type AttackCategory = (typeof ATTACK_CATEGORIES)[number];

export const StoreResultSchema = z.object({
  sessions: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  conversion_pct: z.number(),
  revenue_paise: z.number().int().nonnegative(),
  avg_order_paise: z.number().int().nonnegative(),
  upsell_paise: z.number().int().nonnegative(),
  upsell_pct: z.number(),
  bundles: z.number().int().nonnegative(),
});
export type StoreResult = z.infer<typeof StoreResultSchema>;

export const AttackCategoryResultSchema = z.object({
  category: z.enum(ATTACK_CATEGORIES),
  attempted: z.number().int().nonnegative(),
  caught: z.number().int().nonnegative(),
  breaches: z.number().int().nonnegative(),
  reason_codes: z.record(z.string(), z.number().int().nonnegative()),
});
export type AttackCategoryResult = z.infer<typeof AttackCategoryResultSchema>;

export const EvalHeadlineSchema = z.object({
  breaches: z.number().int().nonnegative(),
  attacks: z.number().int().nonnegative(),
  explained_pct: z.number(),
  revenue_uplift_pct: z.number(),
  ran_at: z.string(),
});
export type EvalHeadline = z.infer<typeof EvalHeadlineSchema>;

export const EvalReportSchema = z.object({
  version: z.literal(1),
  ran_at: z.string(),
  seed: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
  modes: z.object({
    llm: z.enum(["openai", "fallback"]),
    payments: z.enum(["mock", "razorpay"]),
    search: z.string(),
  }),
  benchmark: z.object({
    intents: z.number().int().nonnegative(),
    baseline: StoreResultSchema,
    agentgate: StoreResultSchema,
    uplift: z.object({ revenue_paise: z.number().int(), revenue_pct: z.number(), conversion_pts: z.number() }),
  }),
  red_team: z.object({
    attacks: z.number().int().nonnegative(),
    breaches: z.number().int().nonnegative(),
    caught: z.number().int().nonnegative(),
    by_category: z.array(AttackCategoryResultSchema),
    catch_rate_by_reason: z.record(z.string(), z.number()),
    control_sessions: z.number().int().nonnegative(),
    control_blocked: z.number().int().nonnegative(),
    false_block_rate_pct: z.number(),
  }),
  coverage: z.object({
    money_actions: z.number().int().nonnegative(),
    with_human_reason_pct: z.number(),
    with_policy_check_pct: z.number(),
    chain_intact: z.boolean(),
    ledger_entries: z.number().int().nonnegative(),
  }),
  headline: EvalHeadlineSchema,
  hero_line: z.string(),
  caveat: z.string(),
});
export type EvalReport = z.infer<typeof EvalReportSchema>;

export const EVAL_CAVEAT = "Criterion-coverage on synthetic sessions with a scripted adversary; not a market claim.";

export function heroLine(h: EvalHeadline): string {
  const sign = h.revenue_uplift_pct >= 0 ? "+" : "";
  return `${h.breaches} breaches across ${h.attacks} attacks · ${Math.round(h.explained_pct)}% of money actions explained · ${sign}${Math.round(h.revenue_uplift_pct)}% revenue vs a static store`;
}
