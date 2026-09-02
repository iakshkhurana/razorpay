import { json, parseBody, requireMandate } from "@/lib/api";
import { CheckoutRequestSchema } from "@/lib/schemas";
import { checkout, orderView } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/** Turns an accepted offer into an order — only when the engine says ALLOW (or parks it on GATE). */
export async function POST(req: Request) {
  const body = await parseBody(req, CheckoutRequestSchema);
  if (!body.ok) return body.response;

  const mandate = requireMandate(body.data.mandate_token, "checkout");
  if (!mandate.ok) return mandate.response;

  const result = await checkout({ mandate: mandate.claims, offer_id: body.data.offer_id, now: mandate.now });
  if (!result.ok) {
    return json({ ok: false, verdict: result.verdict, order: null, ledger_entry_id: result.entry.id }, 409);
  }
  // The engine allowed it but the provider could not issue a link: nothing was
  // charged, the refusal is already in the book, and the order can be retried.
  if (result.payment_error) {
    return json(
      {
        ok: false,
        error: `The payment provider could not create a link: ${result.payment_error}. Nothing was charged — retry this offer.`,
        verdict: result.verdict,
        order: orderView(result.order),
        ledger_entry_id: result.entry.id,
      },
      502,
    );
  }
  return json({
    ok: true,
    verdict: result.verdict,
    order: orderView(result.order),
    payment_url: result.order.payment_url,
    duplicate: result.duplicate,
    ledger_entry_id: result.entry.id,
  });
}
