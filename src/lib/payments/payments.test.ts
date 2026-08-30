import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";

import { idempotencyKey } from "../db";
import { computeIdempotencyKey, getPaymentPort, paymentsMode } from "./index";
import { MockPaymentPort } from "./mock";
import type { CreateOrderInput } from "./port";
import {
  PaymentProviderError,
  RazorpayPaymentPort,
  fallbackIdempotencyKey,
  referenceIdFor,
  type RazorpayClientLike,
} from "./razorpay";

const WEBHOOK_SECRET = "whsec_test_secret";

const baseInput: CreateOrderInput = {
  order_id: "ord_1",
  amount_paise: 184900,
  description: "Cotton Handloom Saree + Matching Blouse Piece",
  idempotency_key: "mnd_1:off_1",
  customer: { name: "Priya Sharma", email: "priya@example.com" },
};

function sign(body: string, secret: string = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function linkPaidBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event: "payment_link.paid",
    contains: ["payment", "order", "payment_link"],
    payload: {
      payment_link: {
        entity: {
          id: "plink_ABC123",
          reference_id: "mnd_1:off_1",
          amount: 184900,
          amount_paid: 184900,
          status: "paid",
          notes: { order_id: "ord_1", idempotency_key: "mnd_1:off_1" },
        },
      },
      payment: {
        entity: { id: "pay_XYZ789", amount: 184900, status: "captured", notes: { order_id: "ord_1" } },
      },
    },
    created_at: 1700000000,
    ...overrides,
  });
}

function paymentBody(event: "payment.captured" | "payment.failed", notes: unknown = { order_id: "ord_1" }): string {
  return JSON.stringify({
    entity: "event",
    event,
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: "pay_FAIL1",
          amount: 184900,
          status: event === "payment.failed" ? "failed" : "captured",
          notes,
          error_code: event === "payment.failed" ? "BAD_REQUEST_ERROR" : null,
          error_description: event === "payment.failed" ? "Payment failed at the bank." : null,
        },
      },
    },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MockPaymentPort", () => {
  it("builds the mock-pay URL from APP_URL", async () => {
    vi.stubEnv("APP_URL", "https://agentgate.example/");
    const port = new MockPaymentPort();
    const handle = await port.createOrder(baseInput);
    expect(handle).toEqual({
      payment_ref: "mockpay_ord_1",
      payment_url: "https://agentgate.example/dev/mock-pay?order=ord_1",
      provider: "mock",
    });
  });

  it("defaults APP_URL to localhost:3000", async () => {
    vi.stubEnv("APP_URL", "");
    const handle = await new MockPaymentPort().createOrder(baseInput);
    expect(handle.payment_url).toBe("http://localhost:3000/dev/mock-pay?order=ord_1");
  });

  it("parses success and failure bodies into captured / failed events", () => {
    const port = new MockPaymentPort();
    const success = port.verifyWebhook(JSON.stringify({ order_id: "ord_1", outcome: "success" }), "ignored-sig");
    expect(success).toEqual({
      ok: true,
      event: { type: "captured", payment_ref: "mockpay_ord_1", order_id: "ord_1", amount_paise: null, raw_event: "mock.success" },
    });

    const failure = port.verifyWebhook(JSON.stringify({ order_id: "ord_1", outcome: "failure" }), null);
    expect(failure.ok).toBe(true);
    if (failure.ok) {
      expect(failure.event.type).toBe("failed");
      expect(failure.event.raw_event).toBe("mock.failure");
    }
  });

  it("rejects malformed JSON and bad shapes with ok:false", () => {
    const port = new MockPaymentPort();
    const malformed = port.verifyWebhook("{not json", null);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("malformed");

    const badShape = port.verifyWebhook(JSON.stringify({ order_id: "ord_1", outcome: "maybe" }), null);
    expect(badShape.ok).toBe(false);
    if (!badShape.ok) expect(badShape.reason).toBe("malformed");
  });

  it("issues a fallback link with a new ref that carries the attempt", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const port = new MockPaymentPort();
    const first = await port.createOrder(baseInput);
    const retry = await port.issueFallbackLink({ ...baseInput, attempt: 2 });
    expect(retry.payment_ref).not.toBe(first.payment_ref);
    expect(retry.payment_ref).toBe("mockpay_ord_1_retry2");
    expect(retry.payment_url).toBe("http://localhost:3000/dev/mock-pay?order=ord_1&retry=2");
  });

  it("refuses non-integer paise at the boundary", async () => {
    const port = new MockPaymentPort();
    await expect(port.createOrder({ ...baseInput, amount_paise: 1849.5 })).rejects.toThrow();
    await expect(port.createOrder({ ...baseInput, amount_paise: 0 })).rejects.toThrow();
    await expect(port.issueFallbackLink({ ...baseInput, attempt: 0 })).rejects.toThrow();
  });

  it("never throws on non-object JSON bodies", () => {
    const port = new MockPaymentPort();
    for (const body of ["null", "[]", '"order"', "42", "true", ""]) {
      const result = port.verifyWebhook(body, null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("malformed");
    }
  });
});

describe("RazorpayPaymentPort.verifyWebhook", () => {
  const port = new RazorpayPaymentPort({ webhook_secret: WEBHOOK_SECRET });

  it("accepts a correctly signed payment_link.paid and yields a captured event", () => {
    const body = linkPaidBody();
    const result = port.verifyWebhook(body, sign(body));
    expect(result).toEqual({
      ok: true,
      event: {
        type: "captured",
        payment_ref: "plink_ABC123",
        order_id: "ord_1",
        amount_paise: 184900,
        raw_event: "payment_link.paid",
      },
    });
  });

  it("rejects a wrong signature and a missing signature", () => {
    const body = linkPaidBody();
    const wrong = port.verifyWebhook(body, sign(body, "some-other-secret"));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe("signature");

    const missing = port.verifyWebhook(body, null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("signature");

    const tampered = port.verifyWebhook(body.replace("184900", "100"), sign(body));
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.reason).toBe("signature");
  });

  it("rejects signatures of the wrong length or alphabet without throwing", () => {
    const body = linkPaidBody();
    for (const bad of ["", "abc", "0".repeat(63), "zz".repeat(32), `${sign(body)}00`]) {
      const result = port.verifyWebhook(body, bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("signature");
    }
  });

  it("rejects a valid signature replayed onto a different body", () => {
    const paid = linkPaidBody();
    const failed = paymentBody("payment.failed");
    const result = port.verifyWebhook(failed, sign(paid));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature");
  });

  it("rejects everything when no webhook secret is configured", () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    const unconfigured = new RazorpayPaymentPort();
    const body = linkPaidBody();
    const result = unconfigured.verifyWebhook(body, sign(body, ""));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature");
  });

  it("never throws on signed but non-object JSON bodies", () => {
    for (const body of ["null", "[]", '"event"', "42", "{}"]) {
      const result = port.verifyWebhook(body, sign(body));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("malformed");
    }
  });

  it("flags a handled event whose payload lacks its entity as malformed", () => {
    const noLink = JSON.stringify({ entity: "event", event: "payment_link.paid", payload: {} });
    const missingLink = port.verifyWebhook(noLink, sign(noLink));
    expect(missingLink.ok).toBe(false);
    if (!missingLink.ok) expect(missingLink.reason).toBe("malformed");

    const noPayment = JSON.stringify({ entity: "event", event: "payment.failed", payload: { order: { entity: {} } } });
    const missingPayment = port.verifyWebhook(noPayment, sign(noPayment));
    expect(missingPayment.ok).toBe(false);
    if (!missingPayment.ok) expect(missingPayment.reason).toBe("malformed");

    const fractional = paymentBody("payment.captured").replace("184900", "1849.5");
    const badAmount = port.verifyWebhook(fractional, sign(fractional));
    expect(badAmount.ok).toBe(false);
    if (!badAmount.ok) expect(badAmount.reason).toBe("malformed");
  });

  it("prefers the payment link id as payment_ref when payment.captured carries one", () => {
    const body = JSON.stringify({
      entity: "event",
      event: "payment.captured",
      payload: {
        payment: { entity: { id: "pay_XYZ789", amount: 184900, status: "captured", notes: [] } },
        payment_link: { entity: { id: "plink_ABC123", notes: { order_id: "ord_1" } } },
      },
    });
    const result = port.verifyWebhook(body, sign(body));
    expect(result).toEqual({
      ok: true,
      event: { type: "captured", payment_ref: "plink_ABC123", order_id: "ord_1", amount_paise: 184900, raw_event: "payment.captured" },
    });
  });

  it("keeps a failed event usable when notes carry no order id", () => {
    const body = paymentBody("payment.failed", { something_else: "x" });
    const result = port.verifyWebhook(body, sign(body));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe("failed");
      expect(result.event.order_id).toBeNull();
      expect(result.event.payment_ref).toBe("pay_FAIL1");
    }
  });

  it("ignores the payment-link lifecycle events we do not act on", () => {
    for (const event of ["payment_link.expired", "payment_link.cancelled", "payment.authorized", "refund.created"]) {
      const body = JSON.stringify({ entity: "event", event, payload: {} });
      const result = port.verifyWebhook(body, sign(body));
      expect(result).toEqual({ ok: false, error: `Ignored event ${event}.`, reason: "ignored" });
    }
  });

  it("reads the secret from RAZORPAY_WEBHOOK_SECRET when not injected", () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_env");
    const envPort = new RazorpayPaymentPort();
    const body = linkPaidBody();
    expect(envPort.verifyWebhook(body, sign(body, "whsec_env")).ok).toBe(true);
    expect(envPort.verifyWebhook(body, sign(body, WEBHOOK_SECRET)).ok).toBe(false);
  });

  it("maps payment.failed to a failed event keyed by the order in notes", () => {
    const body = paymentBody("payment.failed");
    const result = port.verifyWebhook(body, sign(body));
    expect(result).toEqual({
      ok: true,
      event: { type: "failed", payment_ref: "pay_FAIL1", order_id: "ord_1", amount_paise: 184900, raw_event: "payment.failed" },
    });
  });

  it("maps payment.captured and tolerates Razorpay's empty-array notes", () => {
    const body = paymentBody("payment.captured", []);
    const result = port.verifyWebhook(body, sign(body));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.type).toBe("captured");
      expect(result.event.order_id).toBeNull();
      expect(result.event.payment_ref).toBe("pay_FAIL1");
    }
  });

  it("flags unrelated events as ignored and malformed JSON as malformed", () => {
    const other = JSON.stringify({ entity: "event", event: "order.paid", payload: {} });
    const ignored = port.verifyWebhook(other, sign(other));
    expect(ignored).toEqual({ ok: false, error: "Ignored event order.paid.", reason: "ignored" });

    const junk = "<html>";
    const malformed = port.verifyWebhook(junk, sign(junk));
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("malformed");
  });
});

describe("RazorpayPaymentPort payment links (stubbed SDK)", () => {
  function stubClient(): { client: RazorpayClientLike; create: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn> } {
    const create = vi.fn(async (params: { reference_id?: string }) => ({
      id: `plink_${params.reference_id}`,
      short_url: `https://rzp.io/i/${params.reference_id}`,
      reference_id: params.reference_id,
    }));
    const all = vi.fn(async () => ({ payment_links: [] }));
    const client = { paymentLink: { create, all } } as unknown as RazorpayClientLike;
    return { client, create, all };
  }

  it("creates a link with the idempotency key as reference_id and in notes", async () => {
    vi.stubEnv("APP_URL", "https://agentgate.example");
    const { client, create } = stubClient();
    const port = new RazorpayPaymentPort({ client });
    const handle = await port.createOrder(baseInput);

    expect(handle).toEqual({
      payment_ref: "plink_mnd_1:off_1",
      payment_url: "https://rzp.io/i/mnd_1:off_1",
      provider: "razorpay",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      amount: 184900,
      currency: "INR",
      reference_id: "mnd_1:off_1",
      notes: { order_id: "ord_1", idempotency_key: "mnd_1:off_1" },
      customer: { name: "Priya Sharma", email: "priya@example.com" },
      callback_url: "https://agentgate.example/dashboard?paid=ord_1",
      callback_method: "get",
    });
  });

  it("returns the existing link when Razorpay reports a duplicate reference_id", async () => {
    const { client, create, all } = stubClient();
    create.mockRejectedValueOnce({
      statusCode: 400,
      error: { code: "BAD_REQUEST_ERROR", description: "reference_id already exists", field: "reference_id" },
    });
    all.mockResolvedValueOnce({
      payment_links: [{ id: "plink_existing", short_url: "https://rzp.io/i/existing", reference_id: "mnd_1:off_1" }],
    });
    const port = new RazorpayPaymentPort({ client });
    const handle = await port.createOrder(baseInput);
    expect(handle.payment_ref).toBe("plink_existing");
    expect(handle.payment_url).toBe("https://rzp.io/i/existing");
  });

  it("throws DUPLICATE_REFERENCE when the existing link cannot be recovered", async () => {
    const { client, create, all } = stubClient();
    create.mockRejectedValueOnce({
      statusCode: 400,
      error: { code: "BAD_REQUEST_ERROR", description: "The reference id has already been taken.", field: "reference_id" },
    });
    all.mockResolvedValueOnce({ payment_links: [{ id: "plink_other", short_url: "https://rzp.io/i/other", reference_id: "someone:else" }] });
    const port = new RazorpayPaymentPort({ client });
    await expect(port.createOrder(baseInput)).rejects.toMatchObject({ code: "DUPLICATE_REFERENCE" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not treat other reference_id validation errors as duplicates", async () => {
    const { client, create, all } = stubClient();
    create.mockRejectedValueOnce({
      statusCode: 400,
      error: { code: "BAD_REQUEST_ERROR", description: "The reference id may not be greater than 40 characters.", field: "reference_id" },
    });
    const port = new RazorpayPaymentPort({ client });
    await expect(port.createOrder(baseInput)).rejects.toMatchObject({ code: "BAD_REQUEST_ERROR", status: 400 });
    expect(all).not.toHaveBeenCalled();
  });

  it("wraps a failure while recovering the duplicate link", async () => {
    const { client, create, all } = stubClient();
    create.mockRejectedValueOnce({
      statusCode: 400,
      error: { code: "BAD_REQUEST_ERROR", description: "reference_id already exists", field: "reference_id" },
    });
    all.mockRejectedValueOnce(new Error("socket hang up"));
    const port = new RazorpayPaymentPort({ client });
    const err = await port.createOrder(baseInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    if (err instanceof PaymentProviderError) expect(err.code).toBe("NETWORK");
  });

  it("issues fallback links under a retry-suffixed reference", async () => {
    const { client, create } = stubClient();
    const port = new RazorpayPaymentPort({ client });
    const handle = await port.issueFallbackLink({ ...baseInput, attempt: 2 });
    expect(fallbackIdempotencyKey("mnd_1:off_1", 2)).toBe("mnd_1:off_1:retry2");
    expect(handle.payment_ref).toBe("plink_mnd_1:off_1:retry2");
    expect(create.mock.calls[0][0]).toMatchObject({
      reference_id: "mnd_1:off_1:retry2",
      notes: { order_id: "ord_1", idempotency_key: "mnd_1:off_1:retry2" },
    });
  });

  it("wraps SDK and network failures in PaymentProviderError", async () => {
    const { client, create } = stubClient();
    create.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND api.razorpay.com"));
    const port = new RazorpayPaymentPort({ client });
    const err = await port.createOrder(baseInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    if (err instanceof PaymentProviderError) {
      expect(err.code).toBe("NETWORK");
      expect(err.message).toContain("ENOTFOUND");
    }

    create.mockRejectedValueOnce({ statusCode: 401, error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
    const authErr = await port.createOrder(baseInput).catch((e: unknown) => e);
    expect(authErr).toBeInstanceOf(PaymentProviderError);
    if (authErr instanceof PaymentProviderError) {
      expect(authErr.status).toBe(401);
      expect(authErr.code).toBe("BAD_REQUEST_ERROR");
    }

    create.mockRejectedValueOnce({ statusCode: 502, error: undefined });
    const gatewayErr = await port.createOrder(baseInput).catch((e: unknown) => e);
    expect(gatewayErr).toBeInstanceOf(PaymentProviderError);
    if (gatewayErr instanceof PaymentProviderError) {
      expect(gatewayErr.status).toBe(502);
      expect(gatewayErr.code).toBe("PROVIDER_ERROR");
      expect(gatewayErr.message).toContain("HTTP 502");
    }

    create.mockRejectedValueOnce("string rejection");
    const unknownErr = await port.createOrder(baseInput).catch((e: unknown) => e);
    expect(unknownErr).toBeInstanceOf(PaymentProviderError);
  });

  it("never calls the SDK with fractional paise or a zero attempt", async () => {
    const { client, create } = stubClient();
    const port = new RazorpayPaymentPort({ client });
    await expect(port.createOrder({ ...baseInput, amount_paise: 1849.5 })).rejects.toThrow();
    await expect(port.issueFallbackLink({ ...baseInput, attempt: 0 })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("omits blank customer contact fields from the request", async () => {
    const { client, create } = stubClient();
    const port = new RazorpayPaymentPort({ client });
    await port.createOrder({ ...baseInput, customer: { name: "Priya Sharma" } });
    const sent = create.mock.calls[0][0] as { customer: Record<string, unknown> };
    expect(sent.customer).toEqual({ name: "Priya Sharma" });
  });

  it("fails fast without credentials instead of touching the network", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    const port = new RazorpayPaymentPort();
    await expect(port.createOrder(baseInput)).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
  });

  it("fingerprints reference ids longer than Razorpay's 40-char limit", () => {
    const short = "mnd_1:off_1";
    expect(referenceIdFor(short)).toBe(short);
    const long = "mnd_lx3k9d12_4fq2ab:off_lx3k9d12_9zz1qq:retry1";
    const ref = referenceIdFor(long);
    expect(ref.length).toBeLessThanOrEqual(40);
    expect(ref).toBe(referenceIdFor(long));
    expect(ref).not.toBe(referenceIdFor(`${long}0`));
  });
});

describe("getPaymentPort / paymentsMode", () => {
  it("falls back to mock when PAYMENTS_MODE=razorpay but keys are missing", () => {
    vi.stubEnv("PAYMENTS_MODE", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(paymentsMode()).toBe("mock");
    expect(getPaymentPort().mode).toBe("mock");
    expect(getPaymentPort()).toBeInstanceOf(MockPaymentPort);
    warn.mockRestore();
  });

  it("defaults to mock when PAYMENTS_MODE is unset", () => {
    vi.stubEnv("PAYMENTS_MODE", "");
    expect(paymentsMode()).toBe("mock");
    expect(getPaymentPort().mode).toBe("mock");
  });

  it("reports the effective mode and memoizes one port per mode", () => {
    vi.stubEnv("PAYMENTS_MODE", "mock");
    expect(paymentsMode()).toBe("mock");
    expect(getPaymentPort()).toBe(getPaymentPort());

    vi.stubEnv("PAYMENTS_MODE", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_demo");
    expect(paymentsMode()).toBe("razorpay");
    expect(getPaymentPort().mode).toBe("razorpay");
    expect(getPaymentPort()).toBeInstanceOf(RazorpayPaymentPort);
    expect(getPaymentPort()).toBe(getPaymentPort());

    vi.stubEnv("PAYMENTS_MODE", "anything-else");
    expect(paymentsMode()).toBe("mock");
  });

  it("computeIdempotencyKey matches db.idempotencyKey exactly", () => {
    expect(computeIdempotencyKey("mnd_1", "off_1")).toBe(idempotencyKey("mnd_1", "off_1"));
    expect(computeIdempotencyKey("mnd_1", "off_1")).toBe("mnd_1:off_1");
  });
});
