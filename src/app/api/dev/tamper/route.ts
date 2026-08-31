import { error, isDev, json } from "@/lib/api";
import { tamperLedgerRow } from "@/lib/db";
import { chainSummary, listEntries } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/**
 * Development-only demo: edits the amount on the newest money entry so the
 * integrity badge flips to tampered. The chain is the proof — the only way
 * back is `npm run demo:reset`.
 */
export async function POST() {
  if (!isDev()) return error("The tamper demo is only available in development.", 403);
  const entries = listEntries({ order: "desc" });
  const target = entries.find((e) => e.amount_paise > 0) ?? entries[0];
  if (!target) return error("The ledger is empty — nothing to tamper with.", 409);
  tamperLedgerRow(target.id, { amount_paise: target.amount_paise + 100_000 });
  const chain = chainSummary();
  return json({ ok: true, tampered_entry_id: target.id, chain });
}
