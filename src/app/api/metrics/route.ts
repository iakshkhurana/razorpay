import { json } from "@/lib/api";
import { estimateCostPaise, listMetrics, summarizeMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/** The demo dashboard's data: recent turns with latency, tokens, tools and estimated cost. */
export async function GET() {
  const entries = listMetrics().map((m) => ({ ...m, est_cost_paise: estimateCostPaise(m.llm_calls) }));
  return json({ ok: true, summary: summarizeMetrics(), entries, note: "In-process ring buffer; resets with the server. Costs are estimates from list prices." });
}
