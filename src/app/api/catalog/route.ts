import { json } from "@/lib/api";
import { getMerchant, listSkus } from "@/lib/db";
import { activePolicy } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/** Current shop as the merchant sees it: catalog, policy, live flag. */
export async function GET() {
  return json({ ok: true, merchant: getMerchant(), skus: listSkus(), policy: activePolicy() });
}
