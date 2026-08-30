import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import type { PaymentLinks } from "razorpay/dist/types/paymentLink";
import {
  appBaseUrl,
  CreateOrderInputSchema,
  FallbackLinkInputSchema,
  noteString,
  RAZORPAY_HANDLED_EVENTS,
  RazorpayWebhookEnvelopeSchema,
  RazorpayWebhookSchema,
  type CreateOrderInput,
  type FallbackLinkInput,
  type PaymentEvent,
  type PaymentHandle,
  type PaymentStatus,
  type PaymentPort,
  type RazorpayWebhook,
  type VerifyWebhookResult,
} from "./port";

/* ------------------------------------------------------------------ */
/*  Errors                                                             */
/* ------------------------------------------------------------------ */

export class PaymentProviderError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, opts: { code?: string; status?: number | null; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "PaymentProviderError";
    this.code = opts.code ?? "PROVIDER_ERROR";
    this.status = opts.status ?? null;
  }
}

/** Shape the SDK throws after an HTTP response; `error` is absent when the body was not Razorpay JSON. */
interface SdkError {
  statusCode?: string | number;
  error?: { code?: string; description?: string; field?: unknown; reason?: string } | null;
}

function asSdkError(err: unknown): SdkError | null {
  if (typeof err !== "object" || err === null) return null;
  const candidate = err as SdkError;
  const hasStatus = candidate.statusCode !== undefined && candidate.statusCode !== null;
  const hasError = typeof candidate.error === "object" && candidate.error !== null;
  return hasStatus || hasError ? candidate : null;
}

function toProviderError(err: unknown, action: string): PaymentProviderError {
  if (err instanceof PaymentProviderError) return err;
  const sdk = asSdkError(err);
  if (sdk) {
    const status = Number(sdk.statusCode);
    const detail = sdk.error?.description ?? (Number.isFinite(status) ? `HTTP ${status}` : "unknown error");
    return new PaymentProviderError(`Razorpay ${action} failed: ${detail}`, {
      code: sdk.error?.code ?? "PROVIDER_ERROR",
      status: Number.isFinite(status) ? status : null,
      cause: err,
    });
  }
  if (err instanceof Error) {
    return new PaymentProviderError(`Razorpay ${action} failed: ${err.message}`, { code: "NETWORK", cause: err });
  }
  return new PaymentProviderError(`Razorpay ${action} failed.`, { cause: err });
}

function isDuplicateReference(err: unknown): boolean {
  const sdk = asSdkError(err);
  if (!sdk?.error) return false;
  const text = sdk.error.description ?? "";
  const aboutReference = sdk.error.field === "reference_id" || /reference[_ ]?id/i.test(text);
  return aboutReference && /already|exist|used|duplicate|taken/i.test(text);
}

/* ------------------------------------------------------------------ */
/*  Client                                                             */
/* ------------------------------------------------------------------ */

type PaymentLink = PaymentLinks.RazorpayPaymentLink;
type PaymentLinkCreate = PaymentLinks.RazorpayPaymentLinkCreateRequestBody;

/** The slice of the SDK this adapter touches; tests inject a stub here. */
export interface RazorpayClientLike {
  paymentLink: {
    create(params: PaymentLinkCreate): Promise<PaymentLink>;
    all(params?: { count?: number; skip?: number }): Promise<{ payment_links: PaymentLink[] }>;
    fetch(paymentLinkId: string): Promise<PaymentLink>;
  };
}

export interface RazorpayPortOptions {
  key_id?: string;
  key_secret?: string;
  webhook_secret?: string;
  client?: RazorpayClientLike;
}

const REFERENCE_ID_MAX = 40;

/** Razorpay caps `reference_id` at 40 chars; longer keys are fingerprinted, the full key still travels in notes. */
export function referenceIdFor(key: string): string {
  if (key.length <= REFERENCE_ID_MAX) return key;
  return `ag_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

export function fallbackIdempotencyKey(idempotency_key: string, attempt: number): string {
  return `${idempotency_key}:retry${attempt}`;
}

export class RazorpayPaymentPort implements PaymentPort {
  readonly mode = "razorpay" as const;
  private client: RazorpayClientLike | null;
  private readonly opts: RazorpayPortOptions;

  constructor(opts: RazorpayPortOptions = {}) {
    this.opts = opts;
    this.client = opts.client ?? null;
  }

  private getClient(): RazorpayClientLike {
    if (this.client) return this.client;
    const key_id = this.opts.key_id ?? process.env.RAZORPAY_KEY_ID;
    const key_secret = this.opts.key_secret ?? process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) {
      throw new PaymentProviderError("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set.", {
        code: "MISSING_CREDENTIALS",
      });
    }
    this.client = new Razorpay({ key_id, key_secret });
    return this.client;
  }

  private webhookSecret(): string | null {
    const secret = this.opts.webhook_secret ?? process.env.RAZORPAY_WEBHOOK_SECRET;
    return secret && secret.length > 0 ? secret : null;
  }

  async createOrder(input: CreateOrderInput): Promise<PaymentHandle> {
    const parsed = CreateOrderInputSchema.parse(input);
    return this.createLink(parsed, parsed.idempotency_key, "createOrder");
  }

  async issueFallbackLink(input: FallbackLinkInput): Promise<PaymentHandle> {
    const parsed = FallbackLinkInputSchema.parse(input);
    const key = fallbackIdempotencyKey(parsed.idempotency_key, parsed.attempt);
    return this.createLink(parsed, key, "issueFallbackLink");
  }

  private async createLink(input: CreateOrderInput, key: string, action: string): Promise<PaymentHandle> {
    const reference_id = referenceIdFor(key);
    const body: PaymentLinkCreate = {
      amount: input.amount_paise,
      currency: "INR",
      description: input.description,
      reference_id,
      customer: {
        name: input.customer.name,
        ...(input.customer.email ? { email: input.customer.email } : {}),
        ...(input.customer.contact ? { contact: input.customer.contact } : {}),
      },
      notes: { order_id: input.order_id, idempotency_key: key },
      callback_url: `${appBaseUrl()}/dashboard?paid=${encodeURIComponent(input.order_id)}`,
      callback_method: "get",
    };

    let link: PaymentLink;
    try {
      link = await this.getClient().paymentLink.create(body);
    } catch (err) {
      if (!isDuplicateReference(err)) throw toProviderError(err, action);
      link = await this.findByReference(reference_id, action);
    }
    return { payment_ref: link.id, payment_url: link.short_url, provider: "razorpay" };
  }

  private async findByReference(reference_id: string, action: string): Promise<PaymentLink> {
    let page: { payment_links: PaymentLink[] };
    try {
      page = await this.getClient().paymentLink.all({ count: 100 });
    } catch (err) {
      throw toProviderError(err, action);
    }
    const existing = page.payment_links.find((l) => l.reference_id === reference_id);
    if (!existing) {
      throw new PaymentProviderError(
        `Razorpay ${action}: reference ${reference_id} already used but the existing link was not found.`,
        { code: "DUPLICATE_REFERENCE" },
      );
    }
    return existing;
  }

  /** Payment Link status from Razorpay: paid / partially_paid → paid; expired / cancelled → failed. */
  async fetchStatus(payment_ref: string): Promise<PaymentStatus> {
    let link: PaymentLink;
    try {
      link = await this.getClient().paymentLink.fetch(payment_ref);
    } catch (err) {
      throw toProviderError(err, "fetchStatus");
    }
    switch (link.status) {
      case "paid":
      case "partially_paid":
        return "paid";
      case "expired":
      case "cancelled":
        return "failed";
      case "created":
        return "pending";
      default:
        return "unknown";
    }
  }

  verifyWebhook(rawBody: string, signature: string | null): VerifyWebhookResult {
    if (!signature) {
      return { ok: false, error: "Missing x-razorpay-signature header.", reason: "signature" };
    }
    const secret = this.webhookSecret();
    if (!secret) {
      return { ok: false, error: "RAZORPAY_WEBHOOK_SECRET is not configured.", reason: "signature" };
    }
    if (!signatureMatches(rawBody, signature, secret)) {
      return { ok: false, error: "Webhook signature does not match.", reason: "signature" };
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: "Webhook body is not valid JSON.", reason: "malformed" };
    }
    const envelope = RazorpayWebhookEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      return { ok: false, error: "Webhook body has no event name.", reason: "malformed" };
    }
    if (!(RAZORPAY_HANDLED_EVENTS as readonly string[]).includes(envelope.data.event)) {
      return { ok: false, error: `Ignored event ${envelope.data.event}.`, reason: "ignored" };
    }
    const parsed = RazorpayWebhookSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Webhook payload for ${envelope.data.event} is malformed: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        reason: "malformed",
      };
    }
    return toEvent(parsed.data);
  }
}

/* ------------------------------------------------------------------ */
/*  Webhook mapping                                                    */
/* ------------------------------------------------------------------ */

export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

function signatureMatches(rawBody: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signWebhookBody(rawBody, secret), "utf8");
  const given = Buffer.from(signature.trim(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function toEvent(hook: RazorpayWebhook): VerifyWebhookResult {
  const link = hook.payload.payment_link?.entity;
  const payment = hook.payload.payment?.entity;

  if (hook.event === "payment_link.paid") {
    if (!link) {
      return { ok: false, error: "payment_link.paid without a payment_link entity.", reason: "malformed" };
    }
    const event: PaymentEvent = {
      type: "captured",
      payment_ref: link.id,
      order_id: noteString(link.notes, "order_id") ?? noteString(payment?.notes, "order_id"),
      amount_paise: payment?.amount ?? link.amount_paid ?? link.amount ?? null,
      raw_event: hook.event,
    };
    return { ok: true, event };
  }

  if (!payment) {
    return { ok: false, error: `${hook.event} without a payment entity.`, reason: "malformed" };
  }
  const event: PaymentEvent = {
    type: hook.event === "payment.captured" ? "captured" : "failed",
    payment_ref: link?.id ?? payment.id,
    order_id: noteString(payment.notes, "order_id") ?? noteString(link?.notes, "order_id"),
    amount_paise: payment.amount ?? null,
    raw_event: hook.event,
  };
  return { ok: true, event };
}
