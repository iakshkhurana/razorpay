import { spawn } from "node:child_process";
import { error, isDev, json } from "@/lib/api";
import { saveEvalRun } from "@/lib/db";
import { readEvalReportFile } from "@/lib/eval/report";
import { newId } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/eval/run — development only. The app process keeps the main
 * database open, so the eval runs as a child process (`npx tsx
 * scripts/run-eval.ts`) against its own database and hands the report back
 * through data/eval-latest.json. The report is then copied into the app
 * database so /api/eval/latest can serve it even if the file is cleaned up.
 */

const RUN_TIMEOUT_MS = 5 * 60_000;
const LOG_TAIL_CHARS = 12_000;

interface ChildResult {
  exit_code: number | null;
  timed_out: boolean;
  log: string;
}

let inFlight: Promise<ChildResult> | null = null;

function runChild(): Promise<ChildResult> {
  return new Promise((resolve) => {
    let log = "";
    let settled = false;
    let timedOut = false;
    const append = (chunk: Buffer | string) => {
      log = `${log}${chunk.toString()}`.slice(-LOG_TAIL_CHARS);
    };
    const finish = (exit_code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exit_code, timed_out: timedOut, log });
    };

    const child = spawn("npx tsx scripts/run-eval.ts", {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env, PAYMENTS_MODE: "mock", FORCE_COLOR: "0" },
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, RUN_TIMEOUT_MS);

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (err) => {
      append(`\n${err.message}`);
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

export async function POST() {
  if (!isDev()) return error("The eval runner is available only in development.", 403);
  if (inFlight) return error("An eval run is already in progress. Wait for it to finish, then run again.", 409);

  const startedAt = Date.now();
  inFlight = runChild();
  let result: ChildResult;
  try {
    result = await inFlight;
  } finally {
    inFlight = null;
  }

  const report = readEvalReportFile();
  const fresh = report !== null && Date.parse(report.ran_at) >= startedAt - 1_000;
  if (!report || !fresh) {
    const what = result.timed_out
      ? "The eval run timed out after 5 minutes."
      : `The eval run exited with code ${result.exit_code ?? "unknown"} before writing a report.`;
    return error(`${what} Check the log and run \`npm run eval\` from a terminal.`, 500, { log: result.log });
  }

  saveEvalRun(newId("eval"), report);
  return json({ ok: true, report, exit_code: result.exit_code, log: result.log });
}
