import path from "node:path";

/**
 * `npm run eval` — the evidence layer from the command line.
 *
 * The environment is pinned BEFORE the app modules load so the database module
 * opens the dedicated eval file, never data/agentgate.db, and payments run on
 * the mock adapter. Everything else is imported dynamically for that reason.
 */

process.env.AGENTGATE_DB_PATH = path.join(process.cwd(), "data", "agentgate-eval.db");
process.env.PAYMENTS_MODE = "mock";
if (!process.env.APP_URL) process.env.APP_URL = "http://localhost:3000";

async function main(): Promise<number> {
  const { runEval } = await import("../src/lib/eval/run");
  const { EVAL_REPORT_FILE, renderMarkdown, writeEvalReportFile, writeReadme } = await import("../src/lib/eval/report");
  const { closeDb } = await import("../src/lib/db");

  const report = await runEval({ log: console.log, useLlm: process.env.AGENTGATE_EVAL_LLM === "1" });

  console.log("");
  console.log(report.hero_line);
  console.log("");
  console.log(renderMarkdown(report));

  writeEvalReportFile(report);
  writeReadme(report);
  console.log("");
  console.log(`Wrote the eval block to README.md and the report to ${EVAL_REPORT_FILE}`);
  console.log("");
  console.log(report.caveat);

  closeDb();
  return report.red_team.breaches > 0 ? 1 : 0;
}

/** The model runtime keeps the event loop alive, so exit explicitly — after stdout has drained. */
function exitAfterFlush(code: number): void {
  process.stdout.write("", () => process.exit(code));
}

main().then(exitAfterFlush, (err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  exitAfterFlush(1);
});
