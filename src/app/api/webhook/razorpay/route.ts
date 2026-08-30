import { error, json } from "@/lib/api";
import { getPaymentPort, paymentsMode } from "@/lib/payments";
import { applyPaymentEvent, orderView } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/** Razorpay → us. The signature is checked on the raw body before anything is parsed. */
export async function POST(req: Request) {
  if (paymentsMode() !== "razorpay") {
    return error("Razorpay webhooks are only accepted when PAYMENTS_MODE=razorpay with keys configured.", 503);
  }
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  const verified = getPaymentPort().verifyWebhook(rawBody, signature);
  if (!verified.ok) {
    if (verified.reason === "ignored") return json({ ok: true, ignored: true, detail: verified.error });
    return error(verified.error, verified.reason === "signature" ? 401 : 400);
  }

  const applied = await applyPaymentEvent(verified.event);
  if (!applied.ok) return json({ ok: true, ignored: true, detail: applied.error });
  return json({ ok: true, duplicate: applied.duplicate, order: orderView(applied.order) });
}
