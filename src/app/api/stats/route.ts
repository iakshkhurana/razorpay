import { json } from "@/lib/api";
import { getMerchant, latestEvalRun } from "@/lib/db";
import { readEvalReportFile } from "@/lib/eval/report";
import type { EvalHeadline } from "@/lib/eval/types";
import { llmMode } from "@/lib/llm/router";
import { paymentsMode } from "@/lib/payments";
import { searchMode } from "@/lib/search";
import { getStats } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/** Who speaks for the agents: Sarvam when a key is configured, else the browser's own voices. */
function voiceMode(): "sarvam" | "browser" {
  return process.env.SARVAM_API_KEY?.trim() ? "sarvam" : "browser";
}

/** The newest run recorded in this database, else the committed report from the last CLI run. */
function evalHeadline(): EvalHeadline | null {
  const run = latestEvalRun<{ headline?: EvalHeadline }>();
  if (run?.report.headline) return run.report.headline;
  return readEvalReportFile()?.headline ?? null;
}

export async function GET() {
  const merchant = getMerchant();
  return json({
    ok: true,
    merchant: merchant ? { name: merchant.name, live: merchant.live } : null,
    stats: getStats(),
    eval: evalHeadline(),
    modes: { llm: llmMode(), payments: paymentsMode(), search: searchMode(), voice: voiceMode() },
  });
}
