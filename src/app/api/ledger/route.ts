import { json } from "@/lib/api";
import { chainSummary, listEntries, parsePolicyChecks } from "@/lib/ledger";
import { translateMany } from "@/lib/llm/translate";

export const dynamic = "force-dynamic";

/** The book, newest first. `view=shopkeeper` adds one warm sentence per entry (cached). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") === "shopkeeper" ? "shopkeeper" : "tech";
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));

  const entries = listEntries({ limit, order: "desc" });
  const plain = view === "shopkeeper" ? await translateMany(entries) : null;

  return json({
    ok: true,
    view,
    chain: chainSummary(),
    entries: entries.map((e) => ({
      ...e,
      policy_checks: parsePolicyChecks(e),
      plain: plain?.get(e.id) ?? null,
    })),
  });
}
