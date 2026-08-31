import { listEntries, parsePolicyChecks } from "@/lib/ledger";

export const dynamic = "force-dynamic";

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole book as CSV, oldest first — for auditors and spreadsheets. */
export async function GET() {
  const entries = listEntries({ order: "asc" });
  const header = ["seq", "id", "ts", "actor", "mandate_id", "action", "amount_paise", "verdict", "reason_code", "human_reason", "policy_checks", "prev_hash", "hash"];
  const lines = [header.join(",")];
  entries.forEach((e, i) => {
    const checks = parsePolicyChecks(e)
      .map((c) => `${c.rule}:${c.result}`)
      .join("|");
    lines.push(
      [i + 1, e.id, e.ts, e.actor, e.mandate_id, e.action, e.amount_paise, e.verdict, e.reason_code, csvCell(e.human_reason), csvCell(checks), e.prev_hash, e.hash].join(","),
    );
  });
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="agentgate-ledger.csv"`,
      "cache-control": "no-store",
    },
  });
}
