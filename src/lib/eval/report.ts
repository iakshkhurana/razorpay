import fs from "node:fs";
import path from "node:path";
import { formatINR } from "../money";
import { EvalReportSchema, type EvalReport, type StoreResult } from "./types";

/**
 * Renders an eval report as Markdown and writes it into README.md between the
 * EVAL markers. Also owns the JSON hand-off file that `npm run eval` writes and
 * the API routes read, so the app database is never opened by the eval process.
 */

export const EVAL_START = "<!-- EVAL:START -->";
export const EVAL_END = "<!-- EVAL:END -->";

export const EVAL_REPORT_FILE = path.join(process.cwd(), "data", "eval-latest.json");

/* ------------------------------------------------------------------ */
/*  JSON hand-off                                                      */
/* ------------------------------------------------------------------ */

export function writeEvalReportFile(report: EvalReport, file = EVAL_REPORT_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/** The last report `npm run eval` wrote, or null when there is none or it does not validate. */
export function readEvalReportFile(file = EVAL_REPORT_FILE): EvalReport | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = EvalReportSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Markdown                                                           */
/* ------------------------------------------------------------------ */

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function signed(n: number, unit: "paise" | "pct" | "pts"): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (unit === "paise") return `${sign}${formatINR(abs)}`;
  if (unit === "pct") return `${sign}${abs.toFixed(1)}%`;
  return `${sign}${abs.toFixed(1)} pts`;
}

function upsellCell(s: StoreResult): string {
  if (s.upsell_paise === 0) return "—";
  return `${formatINR(s.upsell_paise)} (${pct(s.upsell_pct)})`;
}

function reasonCodesCell(codes: Record<string, number>): string {
  const entries = Object.entries(codes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length > 0 ? entries.map(([code, n]) => `${code} ×${n}`).join(", ") : "—";
}

export function renderMarkdown(report: EvalReport): string {
  const { benchmark: b, red_team: rt, coverage: c } = report;
  const lines: string[] = [];

  lines.push(`**${report.hero_line}**`, "");

  lines.push(`### Benchmark — ${b.intents} seeded buyer intents`, "");
  lines.push("| Metric | Baseline (static store) | AgentGate |", "|---|---:|---:|");
  lines.push(`| Conversion | ${pct(b.baseline.conversion_pct)} | ${pct(b.agentgate.conversion_pct)} |`);
  lines.push(`| Orders | ${b.baseline.orders} | ${b.agentgate.orders} |`);
  lines.push(`| Revenue | ${formatINR(b.baseline.revenue_paise)} | ${formatINR(b.agentgate.revenue_paise)} |`);
  lines.push(`| Avg order | ${formatINR(b.baseline.avg_order_paise)} | ${formatINR(b.agentgate.avg_order_paise)} |`);
  lines.push(`| Upsell | ${upsellCell(b.baseline)} | ${upsellCell(b.agentgate)} |`);
  lines.push(`| Bundles | ${b.baseline.bundles} | ${b.agentgate.bundles} |`);
  lines.push("");
  lines.push(
    `Uplift: ${signed(b.uplift.revenue_paise, "paise")} revenue (${signed(b.uplift.revenue_pct, "pct")}), ${signed(b.uplift.conversion_pts, "pts")} conversion.`,
    "",
  );

  lines.push(`### Red team — ${rt.attacks} scripted attacks`, "");
  lines.push("| Category | Attempted | Caught | Breaches | Reason codes |", "|---|---:|---:|---:|---|");
  for (const row of rt.by_category) {
    lines.push(`| ${row.category} | ${row.attempted} | ${row.caught} | ${row.breaches} | ${reasonCodesCell(row.reason_codes)} |`);
  }
  lines.push(`| **Total** | **${rt.attacks}** | **${rt.caught}** | **${rt.breaches}** | |`, "");

  lines.push(
    `Coverage: ${pct(c.with_human_reason_pct)} of ${c.money_actions} money actions carry a human reason and ${pct(c.with_policy_check_pct)} carry at least one policy check · ledger chain ${c.chain_intact ? "intact" : "BROKEN"} (${c.ledger_entries} entries).`,
  );
  lines.push(`False blocks: ${rt.control_blocked} of ${rt.control_sessions} legit control sessions (${pct(rt.false_block_rate_pct)}).`, "");

  lines.push(`_${report.caveat}_`, "");
  lines.push(
    `Last run: ${report.ran_at} · seed ${report.seed} · modes llm=${report.modes.llm}, payments=${report.modes.payments}, search=${report.modes.search} · ${(report.duration_ms / 1000).toFixed(1)}s`,
  );

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  README                                                             */
/* ------------------------------------------------------------------ */

/**
 * Replaces everything between the EVAL markers with the rendered report,
 * keeping the markers. Missing markers are appended at the end of the file.
 * Nothing outside the markers is touched.
 */
export function writeReadme(report: EvalReport, readmePath = path.join(process.cwd(), "README.md")): void {
  const block = `${EVAL_START}\n${renderMarkdown(report)}\n${EVAL_END}`;
  const existing = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const start = existing.indexOf(EVAL_START);
  const end = existing.indexOf(EVAL_END, start >= 0 ? start + EVAL_START.length : 0);

  let next: string;
  if (start >= 0 && end >= 0) {
    next = existing.slice(0, start) + block + existing.slice(end + EVAL_END.length);
  } else {
    const trimmed = existing.replace(/\s+$/, "");
    next = trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  }
  fs.writeFileSync(readmePath, next, "utf8");
}
