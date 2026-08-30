import { json } from "@/lib/api";
import { getMerchant, latestEvalRun } from "@/lib/db";
import { llmMode } from "@/lib/llm/router";
import { paymentsMode } from "@/lib/payments";
import { searchMode } from "@/lib/search";
import { getStats } from "@/lib/storefront";

export const dynamic = "force-dynamic";

interface EvalHeadline {
  breaches: number;
  attacks: number;
  explained_pct: number;
  revenue_uplift_pct: number;
  ran_at: string;
}

function evalHeadline(): EvalHeadline | null {
  const run = latestEvalRun<{ headline?: EvalHeadline }>();
  return run?.report.headline ?? null;
}

export async function GET() {
  const merchant = getMerchant();
  return json({
    ok: true,
    merchant: merchant ? { name: merchant.name, live: merchant.live } : null,
    stats: getStats(),
    eval: evalHeadline(),
    modes: { llm: llmMode(), payments: paymentsMode(), search: searchMode() },
  });
}
