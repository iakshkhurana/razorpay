import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Catalog                                                            */
/* ------------------------------------------------------------------ */

export const SkuSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  price_paise: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  category: z.string().min(1),
  image_emoji: z.string().min(1),
});
export type Sku = z.infer<typeof SkuSchema>;

/* ------------------------------------------------------------------ */
/*  Policy                                                             */
/* ------------------------------------------------------------------ */

export const PolicySchema = z.object({
  price_floor_pct: z.number().int().min(0).max(100),
  max_discount_pct: z.number().int().min(0).max(100),
  max_qty_per_order: z.number().int().positive(),
  max_order_value_paise: z.number().int().positive(),
  category_allowlist: z.array(z.string()),
  gate_above_paise: z.number().int().nonnegative(),
  refund_policy: z.string(),
});
export type Policy = z.infer<typeof PolicySchema>;

export const PolicyPatchSchema = PolicySchema.partial();
export type PolicyPatch = z.infer<typeof PolicyPatchSchema>;

export const DEFAULT_POLICY: Policy = {
  price_floor_pct: 85,
  max_discount_pct: 10,
  max_qty_per_order: 4,
  max_order_value_paise: 1_000_000,
  category_allowlist: ["handloom", "gifts"],
  gate_above_paise: 500_000,
  refund_policy: "7-day easy returns on unused items.",
};

/* ------------------------------------------------------------------ */
/*  Mandate (signed by us, presented by the buyer agent)               */
/* ------------------------------------------------------------------ */

export const MandateSchema = z.object({
  agent_id: z.string().min(1),
  user_ref: z.string().min(1),
  spend_cap_paise: z.number().int().positive(),
  category_scope: z.array(z.string()),
  /** unix seconds */
  exp: z.number().int().positive(),
  nonce: z.string().min(8),
});
export type Mandate = z.infer<typeof MandateSchema>;

/** Mandate as it appears inside a verified JWT (includes the mandate id). */
export const MandateClaimsSchema = MandateSchema.extend({
  mandate_id: z.string().min(1),
});
export type MandateClaims = z.infer<typeof MandateClaimsSchema>;

/* ------------------------------------------------------------------ */
/*  Money actions & verdicts                                           */
/* ------------------------------------------------------------------ */

export const MoneyActionTypeSchema = z.enum(["offer", "discount", "checkout"]);
export type MoneyActionType = z.infer<typeof MoneyActionTypeSchema>;

export const MoneyActionSchema = z.object({
  type: MoneyActionTypeSchema,
  sku_ids: z.array(z.string().min(1)).min(1),
  /** quantity applied to each listed SKU */
  qty: z.number().int().positive(),
  proposed_total_paise: z.number().int().nonnegative(),
  discount_pct: z.number().min(0).max(100).default(0),
});
export type MoneyAction = z.infer<typeof MoneyActionSchema>;

export const DecisionSchema = z.enum(["ALLOW", "COUNTER", "GATE", "DENY"]);
export type Decision = z.infer<typeof DecisionSchema>;

export const ReasonCodeSchema = z.enum([
  "OK",
  "MANDATE_EXPIRED",
  "MANDATE_REPLAY",
  "CATEGORY_OUT_OF_SCOPE",
  "SKU_NOT_FOUND",
  "ORDER_VALUE_LIMIT",
  "QTY_LIMIT",
  "SPEND_CAP_EXCEEDED",
  "PRICE_FLOOR",
  "DISCOUNT_LIMIT",
  "HIGH_VALUE_REVIEW",
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const PolicyCheckSchema = z.object({
  rule: z.string(),
  result: z.enum(["pass", "fail", "skip"]),
  detail: z.string(),
});
export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;

export const VerdictSchema = z.object({
  decision: DecisionSchema,
  reason_code: ReasonCodeSchema,
  human_reason: z.string().min(1),
  counter: z
    .object({
      max_total_paise: z.number().int().nonnegative(),
      suggestion: z.string(),
    })
    .optional(),
  policy_checks: z.array(PolicyCheckSchema).min(1),
});
export type Verdict = z.infer<typeof VerdictSchema>;

/* ------------------------------------------------------------------ */
/*  Ledger                                                             */
/* ------------------------------------------------------------------ */

/**
 * Policy decisions plus the payment-lifecycle stamps that the book also records.
 * INFO is for non-money bookkeeping (mandate issued, shop went live).
 */
export const LedgerVerdictSchema = z.enum([
  "ALLOW",
  "COUNTER",
  "GATE",
  "DENY",
  "PAID",
  "FAILED",
  "HELD",
  "INFO",
]);
export type LedgerVerdict = z.infer<typeof LedgerVerdictSchema>;

export const LedgerActorSchema = z.enum([
  "buyer_agent",
  "seller_agent",
  "policy_engine",
  "payments",
  "owner",
  "system",
]);
export type LedgerActor = z.infer<typeof LedgerActorSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string().min(1),
  /** ISO-8601 */
  ts: z.string().min(1),
  actor: LedgerActorSchema,
  mandate_id: z.string(),
  action: z.string().min(1),
  amount_paise: z.number().int(),
  verdict: LedgerVerdictSchema,
  reason_code: z.string().min(1),
  human_reason: z.string().min(1),
  policy_checks_json: z.string(),
  prev_hash: z.string().length(64),
  hash: z.string().length(64),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const GENESIS_HASH = "0".repeat(64);

/* ------------------------------------------------------------------ */
/*  Orders                                                             */
/* ------------------------------------------------------------------ */

export const OrderStatusSchema = z.enum([
  "DRAFT",
  "AWAITING_PAYMENT",
  "PAID",
  "FAILED",
  "HELD",
  "PENDING_APPROVAL",
  "REJECTED",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderSchema = z.object({
  id: z.string().min(1),
  mandate_id: z.string().min(1),
  offer_id: z.string().min(1),
  sku_ids: z.array(z.string()),
  qty: z.number().int().positive(),
  amount_paise: z.number().int().nonnegative(),
  /** list-price total before any bundle/discount, used for uplift reporting */
  list_total_paise: z.number().int().nonnegative(),
  upsell_paise: z.number().int().nonnegative(),
  status: OrderStatusSchema,
  payment_url: z.string().nullable(),
  payment_ref: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

/* ------------------------------------------------------------------ */
/*  Offers (a priced proposal the buyer can check out)                 */
/* ------------------------------------------------------------------ */

export const OfferSchema = z.object({
  id: z.string().min(1),
  mandate_id: z.string().min(1),
  sku_ids: z.array(z.string()).min(1),
  qty: z.number().int().positive(),
  total_paise: z.number().int().nonnegative(),
  list_total_paise: z.number().int().nonnegative(),
  discount_pct: z.number().min(0).max(100),
  is_bundle: z.boolean(),
  verdict: VerdictSchema,
  created_at: z.string(),
});
export type Offer = z.infer<typeof OfferSchema>;

/* ------------------------------------------------------------------ */
/*  Merchant                                                           */
/* ------------------------------------------------------------------ */

export const MerchantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source_url: z.string().nullable(),
  live: z.boolean(),
  created_at: z.string(),
});
export type Merchant = z.infer<typeof MerchantSchema>;

/* ------------------------------------------------------------------ */
/*  API bodies                                                         */
/* ------------------------------------------------------------------ */

export const OnboardRequestSchema = z
  .object({
    url: z.string().url().optional(),
    csv: z.string().optional(),
    merchant_name: z.string().min(1).optional(),
    /** Hinglish voice utterance; only edits policy fields */
    voice_utterance: z.string().optional(),
  })
  .refine((v) => Boolean(v.url || v.csv), {
    message: "Provide a store URL or CSV text.",
  });
export type OnboardRequest = z.infer<typeof OnboardRequestSchema>;

export const PolicyConfirmRequestSchema = z.object({
  merchant_name: z.string().min(1),
  skus: z.array(SkuSchema).min(1),
  policy: PolicySchema,
});
export type PolicyConfirmRequest = z.infer<typeof PolicyConfirmRequestSchema>;

export const MandateIssueRequestSchema = z.object({
  agent_id: z.string().min(1).default("buyer-agent-demo"),
  user_ref: z.string().min(1).default("priya@example.com"),
  spend_cap_paise: z.number().int().positive().default(200_000),
  category_scope: z.array(z.string()).default(["handloom", "gifts"]),
  /** seconds from now; default 1 hour */
  ttl_seconds: z.number().int().positive().default(3600),
});
export type MandateIssueRequest = z.infer<typeof MandateIssueRequestSchema>;

export const ChatRoleSchema = z.enum(["buyer", "seller", "system"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * The language the agents speak on the model path. Hindi is always Devanagari;
 * the deterministic fallbacks stay English. Mirrors `Locale` in lib/i18n/core.
 */
export const LangSchema = z.enum(["en", "hi"]);
export type Lang = z.infer<typeof LangSchema>;

export const NegotiateRequestSchema = z.object({
  mandate_token: z.string().min(1),
  session_id: z.string().min(1).optional(),
  message: z.string().min(1),
  lang: LangSchema.default("en"),
});
export type NegotiateRequest = z.infer<typeof NegotiateRequestSchema>;

export const CheckoutRequestSchema = z.object({
  mandate_token: z.string().min(1),
  offer_id: z.string().min(1),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

export const SimulateWebhookRequestSchema = z.object({
  order_id: z.string().min(1),
  outcome: z.enum(["success", "failure"]),
});
export type SimulateWebhookRequest = z.infer<typeof SimulateWebhookRequestSchema>;

export const ApprovalRequestSchema = z.object({
  order_id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/* ------------------------------------------------------------------ */
/*  Verdict events surfaced to UIs (simulator stamps, tour)            */
/* ------------------------------------------------------------------ */

export const VerdictEventSchema = z.object({
  action: MoneyActionTypeSchema,
  verdict: VerdictSchema,
  amount_paise: z.number().int().nonnegative(),
  offer_id: z.string().optional(),
  ledger_entry_id: z.string().optional(),
});
export type VerdictEvent = z.infer<typeof VerdictEventSchema>;
