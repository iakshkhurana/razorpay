import { bearerToken, json } from "@/lib/api";
import { getMerchant, listSkus } from "@/lib/db";
import { decodeMandateUnsafe } from "@/lib/mandate";
import { searchCatalog, searchMode } from "@/lib/search";
import { activePolicy } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/**
 * Discovery for AI buyers. Read-only: nothing here is a money action.
 * With a mandate in the Authorization header, results are narrowed to its scope.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const k = Math.min(20, Math.max(1, Number(url.searchParams.get("k") ?? 8) || 8));
  const merchant = getMerchant();
  const policy = activePolicy();

  const token = bearerToken(req);
  const claims = token ? decodeMandateUnsafe(token) : null;
  const scope = claims ? new Set(claims.category_scope.map((c) => c.toLowerCase())) : null;
  const allowlist = new Set(policy.category_allowlist.map((c) => c.toLowerCase()));

  const sellable = (category: string) => {
    const c = category.toLowerCase();
    return allowlist.has(c) && (scope === null || scope.has(c));
  };

  const hits = q
    ? (await searchCatalog(q, k)).map((h) => ({ sku: h.sku, score: Math.round(h.score * 1000) / 1000, sellable: sellable(h.sku.category) }))
    : listSkus()
        .slice(0, k)
        .map((sku) => ({ sku, score: 1, sellable: sellable(sku.category) }));

  return json({
    ok: true,
    merchant: merchant ? { name: merchant.name, live: merchant.live } : null,
    query: q,
    search_mode: searchMode(),
    policy: {
      category_allowlist: policy.category_allowlist,
      refund_policy: policy.refund_policy,
      max_qty_per_order: policy.max_qty_per_order,
    },
    mandate_scope: claims?.category_scope ?? null,
    results: hits,
  });
}
