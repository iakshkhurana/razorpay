"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/demo/client";
import {
  EVAL_CAVEAT,
  EvalHeadlineSchema,
  EvalReportSchema,
  heroLine,
  type AttackCategory,
  type EvalHeadline,
  type EvalReport,
  type StoreResult,
} from "@/lib/eval/types";
import { formatINR, groupIndian } from "@/lib/money";
import { isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";

/* Inlined at build time, so the button only ships in a development build. */
const CAN_RUN = process.env.NODE_ENV === "development";

const POLL_MS = 2000;

const CATEGORY_LABEL: Record<AttackCategory, string> = {
  overspend: "Overspend",
  below_floor: "Below-floor haggling",
  out_of_scope: "Out-of-scope category",
  expired_mandate: "Expired mandate",
  replayed_nonce: "Replayed nonce",
  qty_abuse: "Quantity abuse",
  prompt_injection: "Prompt injection",
};

/* ------------------------------------------------------------------ */
/*  Server calls                                                       */
/* ------------------------------------------------------------------ */

/** The full report when the server serves one; otherwise the headline /api/stats keeps. */
interface Scorecard {
  report: EvalReport | null;
  headline: EvalHeadline | null;
}

const NO_DATA: Scorecard = { report: null, headline: null };

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data;
}

function reportIn(data: unknown): EvalReport | null {
  const raw = typeof data === "object" && data !== null && "report" in data ? (data as { report: unknown }).report : null;
  if (!raw) return null;
  const parsed = EvalReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The stored run is in an older format. Run `npm run eval` again to rewrite it.");
  }
  return parsed.data;
}

/** GET /api/eval/latest â†’ { ok, report | null }. A 404 means the route is missing or nothing has run. */
async function fetchLatest(): Promise<EvalReport | null> {
  try {
    return reportIn(await request("/api/eval/latest"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function fetchScorecard(): Promise<Scorecard> {
  const report = await fetchLatest();
  if (report) return { report, headline: report.headline };
  const { eval: headline } = await api.stats();
  const parsed = EvalHeadlineSchema.safeParse(headline);
  return { report: null, headline: parsed.success ? parsed.data : null };
}

/** POST /api/eval/run (dev only) â†’ { ok, report }. Takes up to a couple of minutes. */
function postRun(): Promise<EvalReport | null> {
  return request("/api/eval/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(reportIn);
}

function describe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Could not reach the shop. Check that the app is running.";
}

function runFailure(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) {
    return "This server has no eval route. Run `npm run eval` in the terminal, then reload this page.";
  }
  return `Eval stopped: ${describe(err).replace(/\.$/, "")}. Press Run eval to try again, or run \`npm run eval\` in the terminal.`;
}

/* ------------------------------------------------------------------ */
/*  Formatting                                                         */
/* ------------------------------------------------------------------ */

function fmtPct(n: number, opts: { sign?: boolean } = {}): string {
  const rounded = Math.round(n * 10) / 10;
  const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const sign = opts.sign && rounded > 0 ? "+" : "";
  return `${sign}${body}%`;
}

function fmtCount(n: number): string {
  return groupIndian(n);
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function topReasonCodes(codes: Record<string, number>, limit = 3): Array<{ code: string; n: number }> {
  return Object.entries(codes)
    .map(([code, n]) => ({ code, n }))
    .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code))
    .slice(0, limit);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

interface ActiveRun {
  done: boolean;
  baseline: string | null;
}

export default function EvalPage() {
  const { toast } = useToast();
  const [card, setCard] = useState<Scorecard>(NO_DATA);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [showRequested, setShowRequested] = useState(false);
  const [emphasis, setEmphasis] = useState(0);

  const activeRun = useRef<ActiveRun | null>(null);
  const redTeamRef = useRef<HTMLElement | null>(null);

  const loadScorecard = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      setCard(await fetchScorecard());
      setLoad({ kind: "ready" });
    } catch (err) {
      setLoad({ kind: "error", message: describe(err) });
    }
  }, []);

  useEffect(() => {
    void loadScorecard();
  }, [loadScorecard]);

  /* Settles a run exactly once, whether the poll or the POST response saw it first. */
  const finishRun = useCallback(
    (run: ActiveRun, next: Scorecard) => {
      if (run.done) return;
      run.done = true;
      setCard(next);
      setLoad({ kind: "ready" });
      setRunning(false);
      toast("Scorecard written.", "money");
    },
    [toast],
  );

  /* While a run is in flight, poll every 2s until a newer ran_at appears. */
  useEffect(() => {
    if (!running) return;
    let inFlight = false;
    const id = window.setInterval(async () => {
      const run = activeRun.current;
      if (!run || run.done || inFlight) return;
      inFlight = true;
      try {
        const next = await fetchScorecard();
        if (next.headline && next.headline.ran_at !== run.baseline) finishRun(run, next);
      } catch {
        /* the next tick, or the POST response, settles it */
      } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [running, finishRun]);

  async function runEval() {
    if (running) return;
    const run: ActiveRun = { done: false, baseline: card.headline?.ran_at ?? null };
    activeRun.current = run;
    setRunError(null);
    setRunning(true);
    try {
      const report = await postRun();
      const next = report ? { report, headline: report.headline } : await fetchScorecard();
      if (run.done) return;
      if (next.headline) {
        finishRun(run, next);
        return;
      }
      run.done = true;
      setRunning(false);
      setRunError("The run finished but wrote no scorecard. Run `npm run eval` in the terminal, then reload this page.");
    } catch (err) {
      if (run.done) return;
      run.done = true;
      setRunning(false);
      setRunError(runFailure(err));
    }
  }

  const onTour = useCallback((detail: TourEventDetail) => {
    if (detail.action === "eval:show" && isTourActive()) setShowRequested(true);
  }, []);
  useTourAction(onTour);

  /* The tour's action can land before the scorecard does; show the red-team figure once both are here. */
  useEffect(() => {
    if (!showRequested || !card.headline) return;
    setShowRequested(false);
    redTeamRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    setEmphasis((n) => n + 1);
  }, [showRequested, card.headline]);

  const { report, headline } = card;
  const empty = !running && load.kind === "ready" && headline === null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink/70">Scorecard Â· measured, not claimed</p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Evidence</h1>
          </div>
          {CAN_RUN ? (
            <Button onClick={runEval} loading={running} disabled={running} aria-describedby="eval-status">
              Run eval
            </Button>
          ) : null}
        </div>

        <div id="eval-status" aria-live="polite" className="mt-3 min-h-[1.25rem] text-sm">
          {running ? <p className="text-ink/70">Running 100 sessions + 40 attacksâ€¦</p> : null}
          {!running && load.kind === "loading" ? <p className="text-ink/70">Loading the scorecardâ€¦</p> : null}
          {runError ? <p className="text-deny">{runError}</p> : null}
          {load.kind === "error" ? (
            <p className="text-deny">
              Could not load the scorecard: {load.message}{" "}
              <button type="button" onClick={() => void loadScorecard()} className="font-medium text-action underline-offset-4 hover:underline">
                Reload scorecard
              </button>
            </p>
          ) : null}
        </div>

        {headline ? <HeroLine line={report?.hero_line ?? heroLine(headline)} /> : null}

        {empty ? <EmptyState /> : null}

        {report ? (
          <div className="mt-10 space-y-8">
            <ResultsTable report={report} />
            <RedTeam ref={redTeamRef} report={report} emphasis={emphasis} />
            <Coverage report={report} />
            <RunMeta report={report} />
          </div>
        ) : headline ? (
          <div className="mt-10">
            <HeadlineCard ref={redTeamRef} headline={headline} emphasis={emphasis} />
          </div>
        ) : null}
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sections                                                           */
/* ------------------------------------------------------------------ */

function HeroLine({ line }: { line: string }) {
  const parts = line.split(" Â· ");
  return (
    <p className="mt-8 max-w-5xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
      {parts.map((part, i) => (
        <span key={`${i}-${part}`}>
          <span className="inline-block">{part}</span>
          {i < parts.length - 1 ? <span className="mx-3 text-ink/30">Â·</span> : null}
        </span>
      ))}
    </p>
  );
}

function EmptyState() {
  return (
    <Card className="ledger-spine ruled-paper mt-8 pl-[6px]">
      <CardContent className="py-10 text-center">
        <p className="font-display text-xl font-semibold tracking-tight">No run yet.</p>
        <p className="mt-2 text-sm text-ink/70">
          Run <code className="rounded-md border border-ink/10 bg-white/60 px-1.5 py-0.5 font-mono text-[13px]">npm run eval</code> to write the scorecard
          {CAN_RUN ? ", or press Run eval above." : "."}
        </p>
      </CardContent>
    </Card>
  );
}

/** The figure the tour lands on. Re-keyed to write itself in again when the tour asks. */
function BreachFigure({ attacks, breaches, emphasis }: { attacks: number; breaches: number; emphasis: number }) {
  const clean = breaches === 0;
  return (
    <p className={cn("font-display text-3xl font-bold leading-none tracking-tight sm:text-4xl", emphasis > 0 && "animate-write-in")}>
      <span className="font-mono tnum">{fmtCount(attacks)}</span> attacks â†’{" "}
      <span className={clean ? "text-money" : "text-deny"}>
        <span className="font-mono tnum">{fmtCount(breaches)}</span> {breaches === 1 ? "breach" : "breaches"}
      </span>
    </p>
  );
}

function RedTeamHeader() {
  return (
    <CardHeader>
      <div>
        <CardTitle id="red-team-title">Red team</CardTitle>
        <p className="mt-1 text-sm text-ink/70">Scripted adversaries try to move money against policy. A breach is money that moved anyway.</p>
      </div>
    </CardHeader>
  );
}

function ResultsTable({ report }: { report: EvalReport }) {
  const { baseline, agentgate, uplift, intents } = report.benchmark;
  const rows: Array<{ label: string; value: (s: StoreResult) => string; money?: boolean }> = [
    { label: "Conversion", value: (s) => fmtPct(s.conversion_pct) },
    { label: "Orders", value: (s) => fmtCount(s.orders) },
    { label: "Revenue", value: (s) => formatINR(s.revenue_paise), money: true },
    { label: "Average order", value: (s) => formatINR(s.avg_order_paise) },
    { label: "Upsell", value: (s) => `${formatINR(s.upsell_paise)} Â· ${fmtPct(s.upsell_pct)}` },
  ];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Results</CardTitle>
          <p className="mt-1 text-sm text-ink/70">
            {fmtCount(intents)} seeded buyer intents, each run once against a static store and once through AgentGate.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-xs font-medium uppercase tracking-[0.12em] text-ink/70">
                <th scope="col" className="py-2 pr-4 text-left font-medium">
                  Metric
                </th>
                <th scope="col" className="py-2 px-4 text-right font-medium">
                  Baseline (static store)
                </th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">
                  AgentGate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="py-3 pr-4 text-left font-medium text-ink">
                    {row.label}
                  </th>
                  <td className={cn("py-3 px-4 text-right font-mono tnum", row.money ? "text-money" : "text-ink/80")}>{row.value(baseline)}</td>
                  <td className={cn("py-3 pl-4 text-right font-mono tnum font-semibold", row.money ? "text-money" : "text-ink")}>
                    {row.value(agentgate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 border-t border-ink/10 pt-3 text-sm text-ink/70">
          Uplift over the static store:{" "}
          <span className="font-mono tnum text-money">
            {uplift.revenue_paise > 0 ? "+" : ""}
            {formatINR(uplift.revenue_paise)}
          </span>{" "}
          revenue (<span className="font-mono tnum">{fmtPct(uplift.revenue_pct, { sign: true })}</span>) Â·{" "}
          <span className="font-mono tnum">
            {uplift.conversion_pts > 0 ? "+" : ""}
            {Math.round(uplift.conversion_pts * 10) / 10}
          </span>{" "}
          pts conversion Â· <span className="font-mono tnum">{fmtCount(agentgate.bundles)}</span> bundles closed.
        </p>
      </CardContent>
    </Card>
  );
}

const RedTeam = forwardRef<HTMLElement, { report: EvalReport; emphasis: number }>(function RedTeam({ report, emphasis }, ref) {
  const rt = report.red_team;
  const attacks = rt.attacks;
  const caughtPct = attacks > 0 ? (rt.caught / attacks) * 100 : 0;
  const breachPct = attacks > 0 ? (rt.breaches / attacks) * 100 : 0;
  const uncounted = Math.max(0, attacks - rt.caught - rt.breaches);

  return (
    <Card>
      <section ref={ref} aria-labelledby="red-team-title" className="scroll-mt-24">
        <RedTeamHeader />
        <CardContent className="space-y-5">
          <BreachFigure key={emphasis} attacks={attacks} breaches={rt.breaches} emphasis={emphasis} />

          <div
            role="img"
            aria-label={`${attacks} attacks: ${rt.caught} caught, ${rt.breaches} breaches${uncounted > 0 ? `, ${uncounted} unclassified` : ""}`}
            className="flex h-7 w-full overflow-hidden rounded-md border border-ink/10 bg-ink/10"
          >
            <div className="h-full bg-money" style={{ width: `${caughtPct}%` }} />
            <div className="h-full bg-deny" style={{ width: `${breachPct}%` }} />
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink/70" aria-hidden="true">
            <li className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-money" /> Caught <span className="font-mono tnum text-ink">{fmtCount(rt.caught)}</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-deny" /> Breaches <span className="font-mono tnum text-ink">{fmtCount(rt.breaches)}</span>
            </li>
            {uncounted > 0 ? (
              <li className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ink/20" /> Unclassified <span className="font-mono tnum text-ink">{fmtCount(uncounted)}</span>
              </li>
            ) : null}
          </ul>

          <div className="overflow-x-auto">
            {rt.by_category.length === 0 ? (
              <p className="py-3 text-sm text-ink/70">No attack categories recorded in this run.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-xs font-medium uppercase tracking-[0.12em] text-ink/70">
                    <th scope="col" className="py-2 pr-4 text-left font-medium">
                      Category
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">
                      Attempted
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">
                      Caught
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">
                      Breaches
                    </th>
                    <th scope="col" className="py-2 pl-3 text-left font-medium">
                      Top reason codes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {rt.by_category.map((c) => {
                    const top = topReasonCodes(c.reason_codes);
                    return (
                      <tr key={c.category}>
                        <th scope="row" className="py-2.5 pr-4 text-left font-medium text-ink">
                          {CATEGORY_LABEL[c.category]}
                        </th>
                        <td className="py-2.5 px-3 text-right font-mono tnum text-ink/80">{fmtCount(c.attempted)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tnum text-money">{fmtCount(c.caught)}</td>
                        <td className={cn("py-2.5 px-3 text-right font-mono tnum", c.breaches > 0 ? "font-semibold text-deny" : "text-ink/80")}>
                          {fmtCount(c.breaches)}
                        </td>
                        <td className="py-2.5 pl-3 text-left">
                          {top.length === 0 ? (
                            <span className="text-ink/70">â€”</span>
                          ) : (
                            <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-ink/70">
                              {top.map((r) => (
                                <span key={r.code}>
                                  {r.code} <span className="text-ink/70">Ã—{r.n}</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </section>
    </Card>
  );
});

/** What the page can show from /api/stats alone: the headline of the last run, without its tables. */
const HeadlineCard = forwardRef<HTMLElement, { headline: EvalHeadline; emphasis: number }>(function HeadlineCard({ headline, emphasis }, ref) {
  return (
    <Card>
      <section ref={ref} aria-labelledby="red-team-title" className="scroll-mt-24">
        <RedTeamHeader />
        <CardContent className="space-y-4">
          <BreachFigure key={emphasis} attacks={headline.attacks} breaches={headline.breaches} emphasis={emphasis} />
          <p className="text-sm text-ink/70">
            <span className="font-mono tnum text-ink">{fmtPct(headline.explained_pct)}</span> of money actions explained Â·{" "}
            <span className="font-mono tnum text-ink">{fmtPct(headline.revenue_uplift_pct, { sign: true })}</span> revenue vs a static store
          </p>
          <div className="space-y-1 text-xs text-ink/70">
            <p>{EVAL_CAVEAT}</p>
            <p className="font-mono tnum">
              Last run <time dateTime={headline.ran_at}>{fmtWhen(headline.ran_at)}</time>
            </p>
          </div>
        </CardContent>
      </section>
    </Card>
  );
});

function Coverage({ report }: { report: EvalReport }) {
  const c = report.coverage;
  const rt = report.red_team;
  return (
    <Card className="ledger-spine ruled-paper pl-[6px]">
      <CardContent className="space-y-2 py-5 text-base">
        <p>
          <span className="font-mono tnum">{fmtPct(c.with_human_reason_pct)}</span> of money actions carry a reason Â·{" "}
          <span className="font-mono tnum">{fmtPct(c.with_policy_check_pct)}</span> carry â‰¥1 policy check Â· chain{" "}
          <span className={cn("font-medium", c.chain_intact ? "text-money" : "text-deny")}>{c.chain_intact ? "âœ“ intact" : "âœ— broken"}</span>
        </p>
        <p className="text-ink/80">
          <span className="font-mono tnum text-ink">{fmtPct(rt.false_block_rate_pct)}</span> false blocks on{" "}
          <span className="font-mono tnum text-ink">{fmtCount(rt.control_sessions)}</span> legit sessions
          {rt.control_blocked > 0 ? (
            <>
              {" "}
              (<span className="font-mono tnum text-ink">{fmtCount(rt.control_blocked)}</span> blocked)
            </>
          ) : null}
        </p>
        <p className="text-sm text-ink/70">
          <span className="font-mono tnum">{fmtCount(c.money_actions)}</span> money actions across{" "}
          <span className="font-mono tnum">{fmtCount(c.ledger_entries)}</span> ledger entries.
        </p>
      </CardContent>
    </Card>
  );
}

function RunMeta({ report }: { report: EvalReport }) {
  return (
    <div className="space-y-2 text-xs text-ink/70">
      <p>{report.caveat}</p>
      <p className="font-mono tnum">
        Last run <time dateTime={report.ran_at}>{fmtWhen(report.ran_at)}</time> Â· seed {report.seed} Â· seller {report.modes.llm} Â· payments{" "}
        {report.modes.payments} Â· search {report.modes.search}
      </p>
    </div>
  );
}
