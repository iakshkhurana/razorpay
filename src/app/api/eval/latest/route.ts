import { json } from "@/lib/api";
import { latestEvalRun } from "@/lib/db";
import { readEvalReportFile } from "@/lib/eval/report";
import { EvalReportSchema, type EvalReport } from "@/lib/eval/types";

export const dynamic = "force-dynamic";

type Source = "db" | "file";

/**
 * GET /api/eval/latest — the newest eval report, whichever wrote it last:
 * the app database (filled by /api/eval/run) or data/eval-latest.json
 * (written by `npm run eval`). `report` is null when nothing has run.
 */
export async function GET() {
  const candidates: Array<{ report: EvalReport; source: Source }> = [];

  const run = latestEvalRun<unknown>();
  const stored = run ? EvalReportSchema.safeParse(run.report) : null;
  if (stored?.success) candidates.push({ report: stored.data, source: "db" });

  const file = readEvalReportFile();
  if (file) candidates.push({ report: file, source: "file" });

  candidates.sort((a, b) => Date.parse(b.report.ran_at) - Date.parse(a.report.ran_at));
  const newest = candidates[0];
  if (!newest) return json({ ok: true, report: null, source: null });
  return json({ ok: true, report: newest.report, source: newest.source });
}
