import { z } from "zod";
import { SimulateWebhookRequestSchema } from "../schemas";

/* ------------------------------------------------------------------ */
/*  Contract                                                           */
/* ------------------------------------------------------------------ */

export type PaymentsMode = "mock" | "razorpay";

export const CreateOrderInputSchema = z.object({
  order_id: z.string().min(1),
  /** integer paise; Razorpay refuses anything under 100 (₹1) */
  amount_paise: z.number().int().positive(),
  description: z.string().min(1),
  /** `mandate_id:offer_id` — see `computeIdempotencyKey` */
  idempotency_key: z.string().min(1),
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    contact: z.string().min(1).optional(),
  }),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const FallbackLinkInputSchema = CreateOrderInputSchema.extend({
  attempt: z.number().int().positive(),
});
export type FallbackLinkInput = z.infer<typeof FallbackLinkInputSchema>;

export interface PaymentHandle {
  payment_ref: string;
  payment_url: string;
  provider: PaymentsMode;
}

export interface PaymentEvent {
  type: "captured" | "failed";
  payment_ref: string;
  order_id: string | null;
  amount_paise: number | null;
  /** provider event name, e.g. `payment_link.paid` or `mock.success` */
  raw_event: string;
}

/**
 * Why a webhook was not turned into an event. `signature` and `malformed`
 * deserve a 4xx; `ignored` is a well-formed event we do not act on and
 * should be acknowledged with a 200 so the provider stops retrying it.
 */
export type VerifyFailureReason = "signature" | "malformed" | "ignored";

export type VerifyWebhookResult =
  | { ok: true; event: PaymentEvent }
  | { ok: false; error: string; reason: VerifyFailureReason };

export type PaymentStatus = "paid" | "pending" | "failed" | "unknown";

export interface PaymentPort {
  readonly mode: PaymentsMode;
  createOrder(input: CreateOrderInput): Promise<PaymentHandle>;
  verifyWebhook(rawBody: string, signature: string | null): VerifyWebhookResult;
  issueFallbackLink(input: FallbackLinkInput): Promise<PaymentHandle>;
  /**
   * Asks the provider for the current state of a payment. Lets a deployment
   * without a reachable webhook URL still confirm payments from the source of
   * truth; the mock adapter has no out-of-band state and reports "unknown".
   */
  fetchStatus(payment_ref: string): Promise<PaymentStatus>;
}

/* ------------------------------------------------------------------ */
/*  Webhook payloads                                                   */
/* ------------------------------------------------------------------ */

export const MockWebhookSchema = SimulateWebhookRequestSchema;
export type MockWebhook = z.infer<typeof MockWebhookSchema>;

export const RAZORPAY_HANDLED_EVENTS = ["payment_link.paid", "payment.captured", "payment.failed"] as const;
export type RazorpayHandledEvent = (typeof RAZORPAY_HANDLED_EVENTS)[number];

/** Razorpay serialises empty notes as `[]`, populated notes as an object. */
const RazorpayNotesSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .nullable()
  .optional();
export type RazorpayNotes = z.infer<typeof RazorpayNotesSchema>;

const RazorpayPaymentEntitySchema = z
  .object({
    id: z.string().min(1),
    amount: z.number().int().nonnegative().optional(),
    status: z.string().optional(),
    notes: RazorpayNotesSchema,
    error_code: z.string().nullable().optional(),
    error_description: z.string().nullable().optional(),
  })
  .passthrough();

const RazorpayPaymentLinkEntitySchema = z
  .object({
    id: z.string().min(1),
    reference_id: z.string().nullable().optional(),
    amount: z.number().int().nonnegative().optional(),
    amount_paid: z.number().int().nonnegative().optional(),
    status: z.string().optional(),
    notes: RazorpayNotesSchema,
  })
  .passthrough();

export const RazorpayWebhookEnvelopeSchema = z.object({ event: z.string().min(1) }).passthrough();

export const RazorpayWebhookSchema = z
  .object({
    event: z.enum(RAZORPAY_HANDLED_EVENTS),
    payload: z
      .object({
        payment_link: z.object({ entity: RazorpayPaymentLinkEntitySchema }).optional(),
        payment: z.object({ entity: RazorpayPaymentEntitySchema }).optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type RazorpayWebhook = z.infer<typeof RazorpayWebhookSchema>;

export function noteString(notes: RazorpayNotes, key: string): string | null {
  if (!notes || Array.isArray(notes)) return null;
  const value = notes[key];
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number") return String(value);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

export function appBaseUrl(): string {
  const raw = process.env.APP_URL?.trim();
  const url = raw && raw.length > 0 ? raw : "http://localhost:3000";
  return url.replace(/\/+$/, "");
}
