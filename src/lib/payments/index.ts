import { idempotencyKey } from "../db";
import { MockPaymentPort } from "./mock";
import type { PaymentPort, PaymentsMode } from "./port";
import { RazorpayPaymentPort } from "./razorpay";

export * from "./port";
export { MockPaymentPort, mockPaymentRef, MOCK_REF_PREFIX } from "./mock";
export {
  PaymentProviderError,
  RazorpayPaymentPort,
  fallbackIdempotencyKey,
  referenceIdFor,
  signWebhookBody,
  type RazorpayClientLike,
  type RazorpayPortOptions,
} from "./razorpay";

let mockPort: MockPaymentPort | null = null;
let razorpayPort: RazorpayPaymentPort | null = null;
let warnedMissingKeys = false;
let warnedMissingWebhookSecret = false;

function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** The mode the app actually runs in: `razorpay` only when asked for AND both keys are present. */
export function paymentsMode(): PaymentsMode {
  if (process.env.PAYMENTS_MODE !== "razorpay") return "mock";
  if (razorpayConfigured()) return "razorpay";
  if (!warnedMissingKeys) {
    warnedMissingKeys = true;
    console.warn(
      "[payments] PAYMENTS_MODE=razorpay but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing; using the mock adapter.",
    );
  }
  return "mock";
}

export function getPaymentPort(): PaymentPort {
  if (paymentsMode() === "razorpay") {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET && !warnedMissingWebhookSecret) {
      warnedMissingWebhookSecret = true;
      console.warn("[payments] RAZORPAY_WEBHOOK_SECRET is not set; every Razorpay webhook will be rejected.");
    }
    razorpayPort ??= new RazorpayPaymentPort();
    return razorpayPort;
  }
  mockPort ??= new MockPaymentPort();
  return mockPort;
}

export function computeIdempotencyKey(mandate_id: string, offer_id: string): string {
  return idempotencyKey(mandate_id, offer_id);
}
