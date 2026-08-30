import {
  appBaseUrl,
  CreateOrderInputSchema,
  FallbackLinkInputSchema,
  MockWebhookSchema,
  type CreateOrderInput,
  type FallbackLinkInput,
  type PaymentEvent,
  type PaymentHandle,
  type PaymentPort,
  type VerifyWebhookResult,
} from "./port";

export const MOCK_REF_PREFIX = "mockpay_";

export function mockPaymentRef(order_id: string, attempt?: number): string {
  const base = `${MOCK_REF_PREFIX}${order_id}`;
  return attempt === undefined ? base : `${base}_retry${attempt}`;
}

function mockPayUrl(order_id: string, attempt?: number): string {
  const url = `${appBaseUrl()}/dev/mock-pay?order=${encodeURIComponent(order_id)}`;
  return attempt === undefined ? url : `${url}&retry=${attempt}`;
}

/**
 * Offline adapter. The `/dev/mock-pay` page posts `{ order_id, outcome }` to
 * `/api/dev/simulate-webhook`, which hands the body to `verifyWebhook`.
 * Retries share the original page; the webhook carries only the order id,
 * so callers correlate by `event.order_id`, not by `payment_ref`.
 */
export class MockPaymentPort implements PaymentPort {
  readonly mode = "mock" as const;

  async createOrder(input: CreateOrderInput): Promise<PaymentHandle> {
    const { order_id } = CreateOrderInputSchema.parse(input);
    return {
      payment_ref: mockPaymentRef(order_id),
      payment_url: mockPayUrl(order_id),
      provider: "mock",
    };
  }

  verifyWebhook(rawBody: string, _signature: string | null): VerifyWebhookResult {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: "Webhook body is not valid JSON.", reason: "malformed" };
    }
    const parsed = MockWebhookSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Webhook body does not match { order_id, outcome }: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        reason: "malformed",
      };
    }
    const { order_id, outcome } = parsed.data;
    const event: PaymentEvent = {
      type: outcome === "success" ? "captured" : "failed",
      payment_ref: mockPaymentRef(order_id),
      order_id,
      amount_paise: null,
      raw_event: `mock.${outcome}`,
    };
    return { ok: true, event };
  }

  async fetchStatus(): Promise<"unknown"> {
    return "unknown";
  }

  async issueFallbackLink(input: FallbackLinkInput): Promise<PaymentHandle> {
    const { order_id, attempt } = FallbackLinkInputSchema.parse(input);
    return {
      payment_ref: mockPaymentRef(order_id, attempt),
      payment_url: mockPayUrl(order_id, attempt),
      provider: "mock",
    };
  }
}
