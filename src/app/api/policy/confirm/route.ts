import { json, parseBody } from "@/lib/api";
import { replaceCatalog, setPolicy, upsertMerchant } from "@/lib/db";
import { indexCatalog } from "@/lib/search";
import { PolicyConfirmRequestSchema } from "@/lib/schemas";
import { recordShopLive } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/** The merchant approves the rulebook. This is the only way a shop goes live. */
export async function POST(req: Request) {
  const body = await parseBody(req, PolicyConfirmRequestSchema);
  if (!body.ok) return body.response;

  const merchant = upsertMerchant({ name: body.data.merchant_name, live: true });
  replaceCatalog(body.data.skus);
  setPolicy(body.data.policy);
  const entry = recordShopLive(merchant.name, body.data.skus.length);
  await indexCatalog(body.data.skus);

  return json({ ok: true, merchant, sku_count: body.data.skus.length, policy: body.data.policy, ledger_entry_id: entry.id });
}
