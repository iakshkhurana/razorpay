import { error, json } from "@/lib/api";
import { chainSummary, verifyEntry } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/**
 * Audit one row of the book. `?id=` recomputes that entry's hash from its own
 * contents and checks that it links to the row before it; without an id you get
 * the whole-chain summary. Read-only, and open on purpose — anyone reading an
 * entry should be able to check it rather than trust a badge.
 */
export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return json({ ok: true, chain: chainSummary() });

  const result = verifyEntry(id);
  if (!result) return error("No ledger entry with that id.", 404);
  return json({ ok: true, entry: result, chain: chainSummary() });
}
