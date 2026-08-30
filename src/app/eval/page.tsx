"use client";

import Link from "next/link";
import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AppShell } from "@/components/AppShell";
import { ShieldCheck } from "@/components/illustrations";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, SkeletonLines } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
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

type ReportSource = "db" | "file" | null;

/** The full report when the server serves one; otherwise the headline /api/stats keeps. */
interface Scorecard {
  report: EvalReport | null;
  headline: EvalHeadline | null;
  source: ReportSource;
}

const NO_DATA: Scorecard = { report: null, headline: null, source: null };

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

function reportIn(data: unknown): { report: EvalReport | null; source: ReportSource } {
  const obj = typeof data === "object" && data !== null ? (data as { report?: unknown; source?: unknown }) : {};
  const source: ReportSource = obj.source === "db" || obj.source === "file" ? obj.source : null;
  if (!obj.report) return { report: null, source };
  const parsed = EvalReportSchema.safeParse(obj.report);
  if (!parsed.success) {
    throw new Error("The stored run is in an older format. Run `npm run eval` again to rewrite it.");
  }
  return { report: parsed.data, source };
}

/** GET /api/eval/latest → { ok, report | null, source }. A 404 means the route is missing or nothing has run. */
async function fetchLatest(): Promise<{ report: EvalReport | null; source: ReportSource }> {
  try {
    return reportIn(await request("/api/eval/latest"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { report: null, source: null };
    throw err;
  }
}

async function fetchScorecard(): Promise<Scorecard> {
  const { report, source } = await fetchLatest();
  if (report) return { report, headline: report.headline, source };
  const { eval: headline } = await api.stats();
  const parsed = EvalHeadlineSchema.safeParse(headline);
  return { report: null, headline: parsed.success ? parsed.data : null, source: null };
}

/** POST /api/eval/run (dev only) → { ok, report }. Blocks for a few seconds up to a couple of minutes. */
function postRun(): Promise<{ report: EvalReport | null; source: ReportSource }> {
  return request("/api/eval/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((data) => {
    const out = reportIn(data);
    return { report: out.report, source: out.report ? "db" : null };
  });
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

/** Reason codes wear the colour of the verdict that raised them — the stamp palette, text always present. */
function reasonTone(code: string): BadgeTone {
  switch (code) {
    case "OK":
      return "green";
    case "SPEND_CAP_EXCEEDED":
    case "PRICE_FLOOR":
    case "DISCOUNT_LIMIT":
    case "QTY_LIMIT":
      return "amber";
    case "HIGH_VALUE_REVIEW":
      return "violet";
    case "MANDATE_EXPIRED":
    case "MANDATE_REPLAY":
    case "CATEGORY_OUT_OF_SCOPE":
    case "SKU_NOT_FOUND":
    case "ORDER_VALUE_LIMIT":
      return "red";
    default:
      return "gray";
  }
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function delay(ms: number): CSSProperties {
  return { "--delay": `${ms}ms` } as CSSProperties;
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
      const posted = await postRun();
      const next: Scorecard = posted.report ? { report: posted.report, headline: posted.report.headline, source: posted.source } : await fetchScorecard();
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

  const { report, headline, source } = card;
  const loading = !running && load.kind === "loading";
  const empty = !running && load.kind === "ready" && headline === null;
  const line = report?.hero_line ?? (headline ? heroLine(headline) : null);

  return (
    <AppShell
      section="evidence"
      title="Evidence"
      subtitle="Measured on synthetic sessions with a scripted adversary — not a market claim."
      actions={
        CAN_RUN ? (
          <Button onClick={runEval} loading={running} disabled={running} aria-describedby="eval-status">
            {running ? "Running eval…" : "Run eval"}
          </Button>
        ) : null
      }
      headerExtra={
        <div id="eval-status" aria-live="polite" className="min-h-[1.25rem] text-sm">
          {running ? (
            <p className="flex flex-wrap items-center gap-2 text-rzp-muted">
              <Badge tone="blue" dot>
                Running
              </Badge>
              100 buyer sessions + 40 attacks against the policy engine. Usually 5–20 seconds.
            </p>
          ) : null}
          {loading ? <p className="text-rzp-muted">Loading the scorecard…</p> : null}
          {runError ? (
            <p className="text-[#B3262C]" role="alert">
              {runError}
            </p>
          ) : null}
          {load.kind === "error" ? (
            <p className="text-[#B3262C]" role="alert">
              Could not load the scorecard: {load.message}{" "}
              <button
                type="button"
                onClick={() => void loadScorecard()}
                className="rounded font-medium text-rzp-blueDeep underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2"
              >
                Reload scorecard
              </button>
            </p>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6" aria-busy={running || loading || undefined}>
        {loading ? <LoadingScorecard /> : null}

        {empty ? <EmptyState onRun={CAN_RUN ? runEval : undefined} /> : null}

        {headline && line ? <HeroBand line={line} headline={headline} /> : null}

        {headline ? <KpiRow headline={headline} report={report} /> : null}

        {report ? (
          <>
            <div className="grid gap-6 xl:grid-cols-5">
              <div className="min-w-0 xl:col-span-3">
                <Benchmark report={report} />
              </div>
              <div className="min-w-0 xl:col-span-2">
                <Coverage report={report} />
              </div>
            </div>
            <RedTeam ref={redTeamRef} report={report} emphasis={emphasis} />
            <RunMeta report={report} source={source} />
          </>
        ) : headline ? (
          <>
            <HeadlineRedTeam ref={redTeamRef} headline={headline} emphasis={emphasis} />
            <div className="space-y-1 text-xs text-rzp-muted">
              <p>{EVAL_CAVEAT}</p>
              <p className="font-mono tnum">
                Last run <time dateTime={headline.ran_at}>{fmtWhen(headline.ran_at)}</time> · headline only — run{" "}
                <code className="rounded border border-rzp-border bg-white px-1 py-0.5">npm run eval</code> for the full tables
              </p>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  States                                                             */
/* ------------------------------------------------------------------ */

function LoadingScorecard() {
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardContent className="py-8">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-10 w-3/4" />
          <Skeleton className="mt-3 h-10 w-1/2" />
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Stat key={i} label="Loading" value="" loading hint="" />
        ))}
      </div>
      <Card>
        <CardContent className="py-6">
          <SkeletonLines lines={4} />
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ onRun }: { onRun?: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid items-center gap-6 px-6 py-10 sm:grid-cols-[auto_1fr] sm:px-10">
        <ShieldCheck className="mx-auto w-44 sm:w-52" title="A shield with a check mark — the evidence layer" />
        <div className="text-center sm:text-left">
          <p className="font-display text-2xl font-bold tracking-tight text-rzp-text">No run yet.</p>
          <p className="mt-2 max-w-xl text-sm text-rzp-muted">
            The scorecard writes itself from a real run: 100 seeded buyer sessions through a static store and through AgentGate, then 40 scripted
            attacks on the policy engine. Nothing here is typed in by hand.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            {onRun ? <Button onClick={onRun}>Run eval</Button> : null}
            <p className="text-sm text-rzp-muted">
              {onRun ? "or run " : "Run "}
              <code className="rounded-md border border-rzp-border bg-rzp-mist px-1.5 py-0.5 font-mono text-[13px] text-rzp-text">npm run eval</code> in
              the terminal, then reload.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero band + KPIs                                                   */
/* ------------------------------------------------------------------ */

const HERO_BG: CSSProperties = {
  backgroundImage:
    "radial-gradient(520px 320px at 8% 0%, rgba(255,255,255,0.9), transparent 62%), radial-gradient(460px 300px at 92% 100%, rgba(51,149,255,0.28), transparent 60%), linear-gradient(135deg, #DCEBFF 0%, #EEF4FF 48%, #FFFFFF 100%)",
};

function HeroBand({ line, headline }: { line: string; headline: EvalHeadline }) {
  const parts = line.split(" · ");
  const clean = headline.breaches === 0;
  return (
    <Card className="relative overflow-hidden border-white/70" style={HERO_BG}>
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
      <div className="relative grid items-center gap-6 px-6 py-8 sm:px-8 lg:grid-cols-[1fr_auto] lg:py-10">
        <div className="fade-up min-w-0" style={delay(0)}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={clean ? "green" : "red"} dot>
              {clean ? "Policy held" : "Policy breached"}
            </Badge>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-rzp-muted">Scorecard · measured, not claimed</span>
          </div>
          <h2 className="mt-4 max-w-4xl font-display text-3xl font-bold leading-[1.08] tracking-tight text-rzp-text sm:text-4xl lg:text-5xl">
            {parts.map((part, i) => (
              <span key={`${i}-${part}`} className="inline">
                <span className={cn("inline", i === 0 && (clean ? "text-[#087443]" : "text-[#B3262C]"))}>{part}</span>
                {i < parts.length - 1 ? (
                  <span className="mx-3 text-rzp-blue/60" aria-hidden="true">
                    ·
                  </span>
                ) : null}
              </span>
            ))}
          </h2>
          <p className="mt-4 max-w-2xl text-sm text-rzp-muted">
            Every figure on this page comes from the last run of the evidence harness — the same policy engine, mandates and ledger the shop sells with.
          </p>
        </div>
        <div className="fade-up mx-auto lg:mx-0" style={delay(140)}>
          <ShieldCheck className="w-44 sm:w-52 lg:w-60" title="A shield with a check mark: the policy engine held on every attack" />
        </div>
      </div>
    </Card>
  );
}

function KpiRow({ headline, report }: { headline: EvalHeadline; report: EvalReport | null }) {
  const clean = headline.breaches === 0;
  const rt = report?.red_team ?? null;
  const uplift = report?.benchmark.uplift ?? null;
  const upliftPct = Math.round(headline.revenue_uplift_pct);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        className="fade-up"
        style={delay(60)}
        label="Breaches"
        value={
          <>
            {fmtCount(headline.breaches)}
            <span className="text-lg font-medium text-rzp-muted"> / {fmtCount(headline.attacks)}</span>
          </>
        }
        tone={clean ? "green" : "red"}
        hint={clean ? "Money never moved against policy" : "Money moved against policy — investigate the run"}
        icon={<ShieldGlyph />}
      />
      <Stat
        className="fade-up"
        style={delay(120)}
        label="Explained"
        value={fmtPct(headline.explained_pct)}
        tone={headline.explained_pct >= 100 ? "green" : "amber"}
        hint="Money actions with a reason and a policy check"
        icon={<BookGlyph />}
      />
      <Stat
        className="fade-up"
        style={delay(180)}
        label="Revenue uplift"
        value={`${upliftPct > 0 ? "+" : ""}${upliftPct}%`}
        tone="blue"
        delta={uplift ? { label: `${uplift.revenue_paise > 0 ? "+" : ""}${formatINR(uplift.revenue_paise)}`, direction: uplift.revenue_paise >= 0 ? "up" : "down" } : undefined}
        hint={uplift ? `vs a static store · exact ${fmtPct(headline.revenue_uplift_pct, { sign: true })}` : "vs a static store"}
        icon={<TrendGlyph />}
      />
      <Stat
        className="fade-up"
        style={delay(240)}
        label="False blocks"
        value={rt ? fmtPct(rt.false_block_rate_pct) : "—"}
        tone={rt ? (rt.control_blocked === 0 ? "green" : "amber") : "default"}
        hint={rt ? `${fmtCount(rt.control_blocked)} of ${fmtCount(rt.control_sessions)} legit control sessions blocked` : "Run the full eval for control-session data"}
        icon={<CheckGlyph />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Benchmark: grouped bars + results table                            */
/* ------------------------------------------------------------------ */

const SERIES = {
  baseline: { label: "Baseline · static store", color: "#2F4F9A" },
  agentgate: { label: "AgentGate", color: "#3395FF" },
} as const;

interface Metric {
  key: string;
  label: string;
  pick: (s: StoreResult) => number;
  fmt: (n: number) => string;
}

const CHART_METRICS: Metric[] = [
  { key: "conversion", label: "Conversion", pick: (s) => s.conversion_pct, fmt: (n) => fmtPct(n) },
  { key: "revenue", label: "Revenue", pick: (s) => s.revenue_paise, fmt: (n) => formatINR(n) },
  { key: "avg_order", label: "Average order", pick: (s) => s.avg_order_paise, fmt: (n) => formatINR(n) },
];

/** Width of the chart's box, measured after mount; the first render uses a fixed width so hydration stays clean. */
function useMeasuredWidth(fallback: number): [React.RefCallback<HTMLDivElement>, number] {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number" && w > 0) setWidth(Math.round(w));
    });
    ro.observe(node);
    observer.current = ro;
  }, []);
  return [ref, width];
}

/** A bar with a 4px rounded data-end and a square base. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, Math.max(0, w), h / 2);
  return `M${x} ${y}h${Math.max(0, w - rr)}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - 2 * rr}a${rr} ${rr} 0 0 1 -${rr} ${rr}H${x}Z`;
}

const BAR_H = 14;
const BAR_GAP = 3;
const GROUP_HEAD = 20;
const GROUP_PAD = 18;
const VALUE_ROOM = 104;

function BenchmarkChart({ baseline, agentgate }: { baseline: StoreResult; agentgate: StoreResult }) {
  const [boxRef, width] = useMeasuredWidth(560);
  const trackW = Math.max(120, width - VALUE_ROOM);
  const groupH = GROUP_HEAD + BAR_H * 2 + BAR_GAP + GROUP_PAD;
  const height = CHART_METRICS.length * groupH - GROUP_PAD + 4;

  const summary = CHART_METRICS.map((m) => `${m.label}: baseline ${m.fmt(m.pick(baseline))}, AgentGate ${m.fmt(m.pick(agentgate))}`).join("; ");

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-rzp-muted" aria-label="Series">
        {(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[k].color }} aria-hidden="true" />
            <span className="font-medium text-rzp-text">{SERIES[k].label}</span>
          </li>
        ))}
      </ul>
      <div ref={boxRef} className="w-full">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Baseline vs AgentGate. ${summary}`} className="block max-w-full">
          {CHART_METRICS.map((m, gi) => {
            const gy = gi * groupH;
            const vb = m.pick(baseline);
            const va = m.pick(agentgate);
            const max = Math.max(vb, va, 1);
            const rows: Array<{ key: keyof typeof SERIES; v: number }> = [
              { key: "baseline", v: vb },
              { key: "agentgate", v: va },
            ];
            return (
              <g key={m.key}>
                <text x="0" y={gy + 12} fill="#5B6B8C" fontSize="11" fontWeight="600" letterSpacing="0.08em" fontFamily="var(--font-body), system-ui, sans-serif">
                  {m.label.toUpperCase()}
                </text>
                {rows.map((row, ri) => {
                  const y = gy + GROUP_HEAD + ri * (BAR_H + BAR_GAP);
                  const w = row.v > 0 ? Math.max(2, Math.round((row.v / max) * trackW)) : 0;
                  const label = m.fmt(row.v);
                  return (
                    <g key={row.key} className="transition-opacity hover:opacity-80">
                      <title>{`${SERIES[row.key].label} — ${m.label}: ${label}`}</title>
                      <rect x="0" y={y} width={trackW} height={BAR_H} fill="#EEF4FF" rx="2" />
                      {w > 0 ? <path d={barPath(0, y, w, BAR_H)} fill={SERIES[row.key].color} /> : null}
                      <text
                        x={w + 8}
                        y={y + BAR_H - 3}
                        fill="#14213D"
                        fontSize="12"
                        fontWeight={row.key === "agentgate" ? 600 : 500}
                        fontFamily="var(--font-mono), ui-monospace, monospace"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Benchmark({ report }: { report: EvalReport }) {
  const { baseline, agentgate, uplift, intents } = report.benchmark;
  const rows: Array<{ label: string; value: (s: StoreResult) => string; money?: boolean }> = [
    { label: "Conversion", value: (s) => fmtPct(s.conversion_pct) },
    { label: "Orders", value: (s) => fmtCount(s.orders) },
    { label: "Revenue", value: (s) => formatINR(s.revenue_paise), money: true },
    { label: "Average order", value: (s) => formatINR(s.avg_order_paise) },
    { label: "Upsell", value: (s) => `${formatINR(s.upsell_paise)} · ${fmtPct(s.upsell_pct)}` },
    { label: "Bundles closed", value: (s) => fmtCount(s.bundles) },
  ];

  return (
    <Card className="fade-up h-full" style={delay(300)}>
      <CardHeader>
        <div>
          <CardTitle>Benchmark</CardTitle>
          <CardDescription className="mt-1">
            {fmtCount(intents)} seeded buyer intents, each run once against a static store and once through AgentGate.
          </CardDescription>
        </div>
        <Badge tone="blue">{fmtCount(intents)} intents</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <BenchmarkChart baseline={baseline} agentgate={agentgate} />

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">Benchmark results, baseline versus AgentGate</caption>
            <thead>
              <tr className="border-b border-rzp-border text-[11px] font-semibold uppercase tracking-[0.12em] text-rzp-muted">
                <th scope="col" className="py-2 pr-4 text-left font-semibold">
                  Metric
                </th>
                <th scope="col" className="py-2 px-4 text-right font-semibold">
                  Baseline
                </th>
                <th scope="col" className="py-2 pl-4 text-right font-semibold">
                  AgentGate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rzp-border">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="py-2.5 pr-4 text-left font-medium text-rzp-text">
                    {row.label}
                  </th>
                  <td className="py-2.5 px-4 text-right font-mono tnum text-rzp-muted">{row.value(baseline)}</td>
                  <td className={cn("py-2.5 pl-4 text-right font-mono tnum font-semibold", row.money ? "text-[#087443]" : "text-rzp-text")}>
                    {row.value(agentgate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="border-t border-rzp-border pt-3 text-sm text-rzp-muted">
          Uplift over the static store:{" "}
          <span className="font-mono tnum font-semibold text-[#087443]">
            {uplift.revenue_paise > 0 ? "+" : ""}
            {formatINR(uplift.revenue_paise)}
          </span>{" "}
          revenue (<span className="font-mono tnum text-rzp-text">{fmtPct(uplift.revenue_pct, { sign: true })}</span>) ·{" "}
          <span className="font-mono tnum text-rzp-text">
            {uplift.conversion_pts > 0 ? "+" : ""}
            {Math.round(uplift.conversion_pts * 10) / 10}
          </span>{" "}
          pts conversion · <span className="font-mono tnum text-rzp-text">{fmtCount(agentgate.bundles)}</span> bundles closed.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Red team                                                           */
/* ------------------------------------------------------------------ */

/** The figure the tour lands on. Re-keyed to write itself in again when the tour asks. */
function BreachFigure({ attacks, breaches, emphasis }: { attacks: number; breaches: number; emphasis: number }) {
  const clean = breaches === 0;
  return (
    <p className={cn("font-display text-3xl font-bold leading-none tracking-tight text-rzp-text sm:text-4xl", emphasis > 0 && "animate-write-in")}>
      <span className="font-mono tnum">{fmtCount(attacks)}</span> attacks →{" "}
      <span className={clean ? "text-[#087443]" : "text-[#B3262C]"}>
        <span className="font-mono tnum">{fmtCount(breaches)}</span> {breaches === 1 ? "breach" : "breaches"}
      </span>
    </p>
  );
}

function StackedBar({ attacks, caught, breaches }: { attacks: number; caught: number; breaches: number }) {
  const caughtPct = attacks > 0 ? (caught / attacks) * 100 : 0;
  const breachPct = attacks > 0 ? (breaches / attacks) * 100 : 0;
  const uncounted = Math.max(0, attacks - caught - breaches);
  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={`${attacks} attacks: ${caught} caught, ${breaches} breaches${uncounted > 0 ? `, ${uncounted} unclassified` : ""}`}
        className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md bg-rzp-mist2 ring-1 ring-inset ring-rzp-border"
      >
        {caughtPct > 0 ? <div className="h-full rounded-l-md bg-rzp-green" style={{ width: `${caughtPct}%` }} title={`Caught: ${caught}`} /> : null}
        {breachPct > 0 ? <div className="h-full bg-rzp-red" style={{ width: `${breachPct}%` }} title={`Breaches: ${breaches}`} /> : null}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-rzp-muted" aria-hidden="true">
        <li className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rzp-green" /> Caught <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(caught)}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rzp-red" /> Breaches <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(breaches)}</span>
        </li>
        {uncounted > 0 ? (
          <li className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rzp-border" /> Unclassified{" "}
            <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(uncounted)}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function RedTeamHeader({ attacks, breaches }: { attacks: number; breaches: number }) {
  return (
    <CardHeader>
      <div>
        <CardTitle id="red-team-title">Red team</CardTitle>
        <CardDescription className="mt-1">Scripted adversaries try to move money against policy. A breach is money that moved anyway.</CardDescription>
      </div>
      <Badge tone={breaches === 0 ? "green" : "red"} dot>
        {fmtCount(attacks)} attacks → {fmtCount(breaches)} {breaches === 1 ? "breach" : "breaches"}
      </Badge>
    </CardHeader>
  );
}

const RedTeam = forwardRef<HTMLElement, { report: EvalReport; emphasis: number }>(function RedTeam({ report, emphasis }, ref) {
  const rt = report.red_team;

  return (
    <Card className="fade-up" style={delay(420)}>
      <section ref={ref} aria-labelledby="red-team-title" className="scroll-mt-24">
        <RedTeamHeader attacks={rt.attacks} breaches={rt.breaches} />
        <CardContent className="space-y-5">
          <BreachFigure key={emphasis} attacks={rt.attacks} breaches={rt.breaches} emphasis={emphasis} />
          <StackedBar attacks={rt.attacks} caught={rt.caught} breaches={rt.breaches} />

          <div className="overflow-x-auto scrollbar-thin">
            {rt.by_category.length === 0 ? (
              <p className="py-3 text-sm text-rzp-muted">No attack categories recorded in this run.</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Attacks by category with catch counts and reason codes</caption>
                <thead>
                  <tr className="border-b border-rzp-border text-[11px] font-semibold uppercase tracking-[0.12em] text-rzp-muted">
                    <th scope="col" className="py-2 pr-4 text-left font-semibold">
                      Category
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-semibold">
                      Attempted
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-semibold">
                      Caught
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-semibold">
                      Breaches
                    </th>
                    <th scope="col" className="py-2 pl-3 text-left font-semibold">
                      Top reason codes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rzp-border">
                  {rt.by_category.map((c) => {
                    const top = topReasonCodes(c.reason_codes);
                    return (
                      <tr key={c.category}>
                        <th scope="row" className="py-2.5 pr-4 text-left font-medium text-rzp-text">
                          {CATEGORY_LABEL[c.category]}
                        </th>
                        <td className="py-2.5 px-3 text-right font-mono tnum text-rzp-muted">{fmtCount(c.attempted)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tnum font-medium text-[#087443]">{fmtCount(c.caught)}</td>
                        <td className={cn("py-2.5 px-3 text-right font-mono tnum", c.breaches > 0 ? "font-semibold text-[#B3262C]" : "text-rzp-muted")}>
                          {fmtCount(c.breaches)}
                        </td>
                        <td className="py-2 pl-3 text-left">
                          {top.length === 0 ? (
                            <span className="text-rzp-muted">—</span>
                          ) : (
                            <span className="flex flex-wrap gap-1.5">
                              {top.map((r) => (
                                <Badge key={r.code} tone={reasonTone(r.code)} className="font-mono text-[11px]">
                                  {r.code}
                                  <span className="opacity-70">×{r.n}</span>
                                </Badge>
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

          <p className="border-t border-rzp-border pt-3 text-sm text-rzp-muted">
            Controls: <span className="font-mono tnum font-medium text-rzp-text">{fmtPct(rt.false_block_rate_pct)}</span> false blocks on{" "}
            <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(rt.control_sessions)}</span> legit sessions
            {rt.control_blocked > 0 ? (
              <>
                {" "}
                (<span className="font-mono tnum text-rzp-text">{fmtCount(rt.control_blocked)}</span> blocked)
              </>
            ) : (
              " — every honest buyer got through."
            )}
          </p>
        </CardContent>
      </section>
    </Card>
  );
});

/** What the page can show from /api/stats alone: the headline of the last run, without its tables. */
const HeadlineRedTeam = forwardRef<HTMLElement, { headline: EvalHeadline; emphasis: number }>(function HeadlineRedTeam({ headline, emphasis }, ref) {
  const caught = Math.max(0, headline.attacks - headline.breaches);
  return (
    <Card className="fade-up" style={delay(300)}>
      <section ref={ref} aria-labelledby="red-team-title" className="scroll-mt-24">
        <RedTeamHeader attacks={headline.attacks} breaches={headline.breaches} />
        <CardContent className="space-y-5">
          <BreachFigure key={emphasis} attacks={headline.attacks} breaches={headline.breaches} emphasis={emphasis} />
          <StackedBar attacks={headline.attacks} caught={caught} breaches={headline.breaches} />
          <p className="text-sm text-rzp-muted">
            <span className="font-mono tnum font-medium text-rzp-text">{fmtPct(headline.explained_pct)}</span> of money actions explained ·{" "}
            <span className="font-mono tnum font-medium text-rzp-text">{fmtPct(headline.revenue_uplift_pct, { sign: true })}</span> revenue vs a static store
          </p>
        </CardContent>
      </section>
    </Card>
  );
});

/* ------------------------------------------------------------------ */
/*  Coverage + run meta                                                */
/* ------------------------------------------------------------------ */

function Coverage({ report }: { report: EvalReport }) {
  const c = report.coverage;
  return (
    <Card className="fade-up h-full" style={delay(360)}>
      <CardHeader>
        <div>
          <CardTitle>Coverage</CardTitle>
          <CardDescription className="mt-1">Every money action must explain itself and sit on an unbroken chain.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Stat
            bare
            className="rounded-xl border border-rzp-border bg-rzp-mist px-4 py-3"
            label="Carry a reason"
            value={fmtPct(c.with_human_reason_pct)}
            tone={c.with_human_reason_pct >= 100 ? "green" : "amber"}
            hint="money actions with a human_reason"
          />
          <Stat
            bare
            className="rounded-xl border border-rzp-border bg-rzp-mist px-4 py-3"
            label="Carry a policy check"
            value={fmtPct(c.with_policy_check_pct)}
            tone={c.with_policy_check_pct >= 100 ? "green" : "amber"}
            hint="money actions with ≥1 policy_check"
          />
          <Stat
            bare
            className="rounded-xl border border-rzp-border bg-rzp-mist px-4 py-3"
            label="Ledger chain"
            value={c.chain_intact ? "✓ Intact" : "✗ Broken"}
            tone={c.chain_intact ? "green" : "red"}
            hint="verifyChain() after the run"
          />
          <Stat
            bare
            className="rounded-xl border border-rzp-border bg-rzp-mist px-4 py-3"
            label="Money actions"
            value={fmtCount(c.money_actions)}
            hint={`across ${fmtCount(c.ledger_entries)} ledger entries`}
          />
        </div>
        <p className="mt-4 text-xs text-rzp-muted">
          Open the{" "}
          <Link href="/dashboard" className={buttonClasses({ variant: "ghost", size: "sm", className: "h-6 rounded-full px-2 text-xs" })}>
            Control Tower
          </Link>{" "}
          to read the chain entry by entry.
        </p>
      </CardContent>
    </Card>
  );
}

function RunMeta({ report, source }: { report: EvalReport; source: ReportSource }) {
  const via = source === "db" ? "written by the in-app runner" : source === "file" ? "written by npm run eval" : null;
  return (
    <div className="space-y-2 text-xs text-rzp-muted">
      <p>{report.caveat}</p>
      <p className="font-mono tnum">
        Last run <time dateTime={report.ran_at}>{fmtWhen(report.ran_at)}</time> · seed {report.seed} · {Math.round(report.duration_ms / 100) / 10}s · seller{" "}
        {report.modes.llm} · payments {report.modes.payments} · search {report.modes.search}
        {via ? ` · ${via}` : ""}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small line glyphs for the KPI tiles                                */
/* ------------------------------------------------------------------ */

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 9.8" />
    </svg>
  );
}

function BookGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11a1 1 0 0 1 1 1v14a1 1 0 0 1-1-1H5.5A1.5 1.5 0 0 1 4 16.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13a1 1 0 0 0-1 1v14a1 1 0 0 1 1-1h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
      <path d="M7 8h2.5M7 11h2.5M14.5 8H17M14.5 11H17" />
    </svg>
  );
}

function TrendGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 17.5 10 11l4 4 6-7" />
      <path d="M15.5 8H20v4.5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </svg>
  );
}
