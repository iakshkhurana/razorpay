import { error, json } from "@/lib/api";
import { MockPaymentPort } from "@/lib/payments";
import { applyPaymentEvent, orderView } from "@/lib/storefront";

export const dynamic = "force-dynamic";

const mock = new MockPaymentPort();

/** The /dev/mock-pay page posts here. Same code path as a real webhook, minus the signature. */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const verified = mock.verifyWebhook(rawBody, null);
  if (!verified.ok) return error(verified.error, 400);

  const applied = await applyPaymentEvent(verified.event);
  if (!applied.ok) return error(applied.error, 404);
  return json({ ok: true, duplicate: applied.duplicate, order: orderView(applied.order) });
}
