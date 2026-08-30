import { json } from "@/lib/api";
import { latestEvalRun } from "@/lib/db";
import { readEvalReportFile } from "@/lib/eval/report";
import { EvalReportSchema } from "@/lib/eval/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/eval/latest — the newest eval report: from the app database when
 * /api/eval/run copied one there, else from data/eval-latest.json written by
 * `npm run eval`, else null.
 */
export async function GET() {
  const run = latestEvalRun<unknown>();
  if (run) {
    const parsed = EvalReportSchema.safeParse(run.report);
    if (parsed.success) return json({ ok: true, report: parsed.data, source: "db" });
  }
  const file = readEvalReportFile();
  if (file) return json({ ok: true, report: file, source: "file" });
  return json({ ok: true, report: null, source: null });
}
