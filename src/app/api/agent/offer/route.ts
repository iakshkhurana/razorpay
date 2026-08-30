import { z } from "zod";
import { json, parseBody, requireMandate } from "@/lib/api";
import { makeOffer } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/**
 * A programmatic buyer names a basket and gets the engine's verdict on it — no chat,
 * no seller agent. The verdict is written to the ledger before this route answers,
 * whatever the decision, and the stored offer is what /api/agent/checkout re-checks.
 */
const OfferRequestSchema = z.object({
  mandate_token: z.string().min(1),
  sku_ids: z.array(z.string().min(1)).min(1).max(20),
  /** quantity applied to each listed SKU; the ceiling keeps totals exact integer paise, the policy's own limit is far lower */
  qty: z.number().int().positive().max(1000).default(1),
  /** declared discount off list price; the engine caps it against the policy */
  discount_pct: z.number().min(0).max(100).default(0),
});

export async function POST(req: Request) {
  const body = await parseBody(req, OfferRequestSchema);
  if (!body.ok) return body.response;

  const mandate = requireMandate(body.data.mandate_token, "offer");
  if (!mandate.ok) return mandate.response;

  const result = makeOffer({
    mandate: mandate.claims,
    sku_ids: body.data.sku_ids,
    qty: body.data.qty,
    discount_pct: body.data.discount_pct,
    actor: "buyer_agent",
    now: mandate.now,
  });

  return json({
    ok: true,
    offer: {
      id: result.offer.id,
      sku_ids: result.offer.sku_ids,
      qty: result.offer.qty,
      total_paise: result.offer.total_paise,
      list_total_paise: result.offer.list_total_paise,
      is_bundle: result.offer.is_bundle,
    },
    verdict: result.verdict,
    ledger_entry_id: result.entry.id,
  });
}
