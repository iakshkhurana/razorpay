"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { AppShell } from "@/components/AppShell";
import { ShieldCheck } from "@/components/illustrations";
import { Counter, EASE_OUT, Reveal } from "@/components/motion";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, SkeletonLines } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/demo/client";
import { useLocale, useT, type Translator } from "@/lib/i18n/core";
import { evalStrings, type EvalKey } from "@/lib/i18n/strings/eval";
import { EvalHeadlineSchema, EvalReportSchema, type AttackCategory, type EvalHeadline, type EvalReport, type StoreResult } from "@/lib/eval/types";
import { formatINR, groupIndian } from "@/lib/money";
import { isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";

/* Inlined at build time, so the button only ships in a development build. */
const CAN_RUN = process.env.NODE_ENV === "development";

const POLL_MS = 2000;

type T = Translator<EvalKey>;

const CATEGORY_KEY: Record<AttackCategory, EvalKey> = {
  overspend: "category.overspend",
  below_floor: "category.below_floor",
  out_of_scope: "category.out_of_scope",
  expired_mandate: "category.expired_mandate",
  replayed_nonce: "category.replayed_nonce",
  qty_abuse: "category.qty_abuse",
  prompt_injection: "category.prompt_injection",
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

/** Thrown when the stored report predates the current schema; the page words it in the reader's language. */
class OldFormatError extends Error {
  constructor() {
    super("old-format");
    this.name = "OldFormatError";
  }
}

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
  if (!parsed.success) throw new OldFormatError();
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

function describe(err: unknown, t: T): string {
  if (err instanceof OldFormatError) return t("error.oldFormat");
  if (err instanceof Error && err.message) return err.message;
  return t("error.unreachable");
}

function runFailure(err: unknown, t: T): string {
  if (err instanceof ApiError && err.status === 404) return t("error.noRoute");
  return t("error.stopped", { message: describe(err, t).replace(/\.$/, "") });
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

function fmtWhen(iso: string, locale: "en" | "hi"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d.toISOString();
  }
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

/** The three hero-line parts, in the reader's language. */
function heroParts(h: EvalHeadline, t: T): string[] {
  const uplift = Math.round(h.revenue_uplift_pct);
  return [
    t(h.breaches === 1 ? "hero.breach" : "hero.breaches", { breaches: fmtCount(h.breaches), attacks: fmtCount(h.attacks) }),
    t("hero.explained", { pct: Math.round(h.explained_pct) }),
    t("hero.uplift", { pct: `${uplift >= 0 ? "+" : ""}${uplift}` }),
  ];
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
  const t = useT(evalStrings);
  const { locale } = useLocale();
  const { toast } = useToast();
  const [card, setCard] = useState<Scorecard>(NO_DATA);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [showRequested, setShowRequested] = useState(false);
  const [emphasis, setEmphasis] = useState(0);

  const activeRun = useRef<ActiveRun | null>(null);
  const redTeamRef = useRef<HTMLElement | null>(null);
  /* the translator for callbacks that outlive a render */
  const tRef = useRef(t);
  tRef.current = t;

  const loadScorecard = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      setCard(await fetchScorecard());
      setLoad({ kind: "ready" });
    } catch (err) {
      setLoad({ kind: "error", message: describe(err, tRef.current) });
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
      toast(tRef.current("page.written"), "money");
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
      setRunError(t("error.noScorecard"));
    } catch (err) {
      if (run.done) return;
      run.done = true;
      setRunning(false);
      setRunError(runFailure(err, t));
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

  return (
    <AppShell
      section="evidence"
      title={t("page.title")}
      subtitle={t("page.subtitle")}
      actions={
        CAN_RUN ? (
          <Button onClick={runEval} loading={running} disabled={running} aria-describedby="eval-status">
            {running ? t("page.running") : t("page.run")}
          </Button>
        ) : null
      }
      headerExtra={
        <div id="eval-status" aria-live="polite" className="min-h-[1.25rem] text-sm">
          {running ? (
            <p className="flex flex-wrap items-center gap-2 text-rzp-muted">
              <Badge tone="blue" dot>
                {t("page.running").replace(/…$/, "")}
              </Badge>
              {t("page.runningNote")}
            </p>
          ) : null}
          {loading ? <p className="text-rzp-muted">{t("page.loading")}</p> : null}
          {runError ? (
            <p className="text-[#B3262C]" role="alert">
              {runError}
            </p>
          ) : null}
          {load.kind === "error" ? (
            <p className="text-[#B3262C]" role="alert">
              {t("page.loadError", { message: load.message })}{" "}
              <button
                type="button"
                onClick={() => void loadScorecard()}
                className="rounded font-medium text-rzp-blueDeep underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2"
              >
                {t("page.reload")}
              </button>
            </p>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6" aria-busy={running || loading || undefined}>
        {loading ? <LoadingScorecard /> : null}

        {empty ? <EmptyState t={t} onRun={CAN_RUN ? runEval : undefined} /> : null}

        {headline ? <HeroBand headline={headline} t={t} /> : null}

        {headline ? <KpiRow headline={headline} report={report} t={t} /> : null}

        {report ? (
          <>
            <div className="grid gap-6 xl:grid-cols-5">
              <Reveal className="min-w-0 xl:col-span-3" amount={0.1}>
                <Benchmark report={report} t={t} />
              </Reveal>
              <Reveal className="min-w-0 xl:col-span-2" delay={0.08} amount={0.1}>
                <Coverage report={report} t={t} />
              </Reveal>
            </div>
            <RedTeam ref={redTeamRef} report={report} emphasis={emphasis} t={t} />
            <Reveal amount={0.1}>
              <Falsification report={report} t={t} />
            </Reveal>
            <RunMeta report={report} source={source} t={t} locale={locale} />
          </>
        ) : headline ? (
          <>
            <HeadlineRedTeam ref={redTeamRef} headline={headline} emphasis={emphasis} t={t} />
            <div className="space-y-1 text-xs text-rzp-muted">
              <p>{t("caveat")}</p>
              <p className="font-mono tnum">
                {t("meta.lastRun")} <time dateTime={headline.ran_at}>{fmtWhen(headline.ran_at, locale)}</time> · {t("meta.headlineOnly")}{" "}
                <code className="rounded border border-rzp-border bg-white px-1 py-0.5">npm run eval</code> {t("meta.headlineTail")}
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
          <Stat key={i} label="…" value="" loading hint="" />
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

function EmptyState({ t, onRun }: { t: T; onRun?: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid items-center gap-6 px-6 py-10 sm:grid-cols-[auto_1fr] sm:px-10">
        <ShieldCheck className="mx-auto w-44 sm:w-52" title={t("empty.alt")} />
        <div className="text-center sm:text-left">
          <p className="font-display text-2xl font-bold tracking-tight text-rzp-text">{t("empty.title")}</p>
          <p className="mt-2 max-w-xl text-sm text-rzp-muted">{t("empty.body")}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            {onRun ? <Button onClick={onRun}>{t("page.run")}</Button> : null}
            <p className="text-sm text-rzp-muted">
              {onRun ? t("empty.or") : t("empty.run")}{" "}
              <code className="rounded-md border border-rzp-border bg-rzp-mist px-1.5 py-0.5 font-mono text-[13px] text-rzp-text">npm run eval</code>{" "}
              {t("empty.terminal")}
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

/* Blue-teal at the top-left, white by the far edge — the marketing hero, folded into a card. */
const HERO_BG: CSSProperties = {
  backgroundImage:
    "radial-gradient(560px 300px at 0% 0%, rgba(46,196,230,0.42), transparent 62%), radial-gradient(520px 320px at 100% 100%, rgba(47,107,255,0.22), transparent 60%), linear-gradient(135deg, #DCE9FF 0%, #EAF3FF 42%, #FFFFFF 100%)",
};

function HeroBand({ headline, t }: { headline: EvalHeadline; t: T }) {
  const parts = heroParts(headline, t);
  const clean = headline.breaches === 0;
  return (
    <Card className="relative overflow-hidden border-white/70" style={HERO_BG}>
      <div className="bg-arcs pointer-events-none absolute inset-0 opacity-80" aria-hidden="true" />
      <div className="relative grid items-center gap-6 px-6 py-8 sm:px-8 lg:grid-cols-[1fr_auto] lg:py-10">
        <div className="fade-up min-w-0" style={delay(0)}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={clean ? "green" : "red"} dot>
              {clean ? t("hero.held") : t("hero.breached")}
            </Badge>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-rzp-muted">{t("hero.eyebrow")}</span>
          </div>
          <h2 className="mt-4 max-w-4xl font-display text-3xl font-bold leading-[1.08] tracking-tight text-rzp-text sm:text-4xl lg:text-5xl">
            {parts.map((part, i) => (
              <span key={`${i}-${part}`} className="inline">
                <span className={cn("inline", i === 0 && (clean ? "text-[#087443]" : "text-[#B3262C]"))}>{part}</span>
                {i < parts.length - 1 ? (
                  <span className="mx-3 text-rzp-teal" aria-hidden="true">
                    ·
                  </span>
                ) : null}
              </span>
            ))}
          </h2>
          <p className="mt-4 max-w-2xl text-sm text-rzp-muted">{t("hero.note")}</p>
        </div>
        <div className="fade-up mx-auto lg:mx-0" style={delay(140)}>
          <ShieldCheck className="w-44 sm:w-52 lg:w-60" title={t("hero.alt")} />
        </div>
      </div>
    </Card>
  );
}

function KpiRow({ headline, report, t }: { headline: EvalHeadline; report: EvalReport | null; t: T }) {
  const clean = headline.breaches === 0;
  const rt = report?.red_team ?? null;
  const uplift = report?.benchmark.uplift ?? null;
  const upliftPct = Math.round(headline.revenue_uplift_pct);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        className="fade-up"
        style={delay(60)}
        label={t("kpi.breaches")}
        value={
          <>
            <Counter value={headline.breaches} duration={1.2} />
            <span className="text-lg font-medium text-rzp-muted"> / {fmtCount(headline.attacks)}</span>
          </>
        }
        tone={clean ? "green" : "red"}
        hint={clean ? t("kpi.breaches.ok") : t("kpi.breaches.bad")}
        icon={<ShieldGlyph />}
      />
      <Stat
        className="fade-up"
        style={delay(120)}
        label={t("kpi.explained")}
        value={<Counter value={Math.round(headline.explained_pct * 10) / 10} suffix="%" />}
        tone={headline.explained_pct >= 100 ? "green" : "amber"}
        hint={t("kpi.explained.hint")}
        icon={<BookGlyph />}
      />
      <Stat
        className="fade-up"
        style={delay(180)}
        label={t("kpi.uplift")}
        value={<Counter value={upliftPct} prefix={upliftPct > 0 ? "+" : ""} suffix="%" />}
        tone="blue"
        delta={uplift ? { label: `${uplift.revenue_paise > 0 ? "+" : ""}${formatINR(uplift.revenue_paise)}`, direction: uplift.revenue_paise >= 0 ? "up" : "down" } : undefined}
        hint={uplift ? t("kpi.uplift.exact", { pct: fmtPct(headline.revenue_uplift_pct, { sign: true }) }) : t("kpi.uplift.hint")}
        icon={<TrendGlyph />}
      />
      <Stat
        className="fade-up"
        style={delay(240)}
        label={t("kpi.falseBlocks")}
        value={rt ? <Counter value={Math.round(rt.false_block_rate_pct * 10) / 10} suffix="%" /> : "—"}
        tone={rt ? (rt.control_blocked === 0 ? "green" : "amber") : "default"}
        hint={rt ? t("kpi.falseBlocks.hint", { blocked: fmtCount(rt.control_blocked), sessions: fmtCount(rt.control_sessions) }) : t("kpi.falseBlocks.none")}
        icon={<CheckGlyph />}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Benchmark: grouped bars + results table                            */
/* ------------------------------------------------------------------ */

const SERIES = {
  baseline: { labelKey: "series.baseline" as EvalKey, color: "#9FB2D6" },
  agentgate: { labelKey: "series.agentgate" as EvalKey, color: "#2F6BFF" },
} as const;

interface Metric {
  key: string;
  labelKey: EvalKey;
  pick: (s: StoreResult) => number;
  fmt: (n: number) => string;
}

const CHART_METRICS: Metric[] = [
  { key: "conversion", labelKey: "metric.conversion", pick: (s) => s.conversion_pct, fmt: (n) => fmtPct(n) },
  { key: "revenue", labelKey: "metric.revenue", pick: (s) => s.revenue_paise, fmt: (n) => formatINR(n) },
  { key: "avg_order", labelKey: "metric.avgOrder", pick: (s) => s.avg_order_paise, fmt: (n) => formatINR(n) },
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

const BAR_H = 14;
const BAR_GAP = 3;
const GROUP_HEAD = 20;
const GROUP_PAD = 18;
const VALUE_ROOM = 104;

function BenchmarkChart({ baseline, agentgate, t }: { baseline: StoreResult; agentgate: StoreResult; t: T }) {
  const [boxRef, width] = useMeasuredWidth(560);
  const reduce = useReducedMotion();
  const gradientId = useId();
  const trackW = Math.max(120, width - VALUE_ROOM);
  const groupH = GROUP_HEAD + BAR_H * 2 + BAR_GAP + GROUP_PAD;
  const height = CHART_METRICS.length * groupH - GROUP_PAD + 4;

  const summary = CHART_METRICS.map((m) => `${t(m.labelKey)}: ${t("series.baseline")} ${m.fmt(m.pick(baseline))}, ${t("series.agentgate")} ${m.fmt(m.pick(agentgate))}`).join("; ");

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-rzp-muted" aria-label={t("benchmark.series")}>
        {(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={k === "agentgate" ? { background: "linear-gradient(90deg, #2F6BFF, #17A9CC)" } : { background: SERIES[k].color }}
              aria-hidden="true"
            />
            <span className="font-medium text-rzp-text">{t(SERIES[k].labelKey)}</span>
          </li>
        ))}
      </ul>
      <div ref={boxRef} className="w-full">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("benchmark.chartLabel", { summary })} className="block max-w-full">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2F6BFF" />
              <stop offset="100%" stopColor="#17A9CC" />
            </linearGradient>
          </defs>
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
                  {t(m.labelKey).toUpperCase()}
                </text>
                {rows.map((row, ri) => {
                  const y = gy + GROUP_HEAD + ri * (BAR_H + BAR_GAP);
                  const w = row.v > 0 ? Math.max(4, Math.round((row.v / max) * trackW)) : 0;
                  const label = m.fmt(row.v);
                  const fill = row.key === "agentgate" ? `url(#${gradientId})` : SERIES[row.key].color;
                  return (
                    <g key={row.key} className="transition-opacity hover:opacity-80">
                      <title>{`${t(SERIES[row.key].labelKey)} — ${t(m.labelKey)}: ${label}`}</title>
                      <rect x="0" y={y} width={trackW} height={BAR_H} fill="#EEF4FF" rx="4" />
                      {w > 0 ? (
                        <motion.rect
                          x="0"
                          y={y}
                          height={BAR_H}
                          rx="4"
                          fill={fill}
                          initial={reduce ? false : { width: 0 }}
                          animate={{ width: w }}
                          transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : 0.1 + gi * 0.12 + ri * 0.08, ease: EASE_OUT }}
                        />
                      ) : null}
                      <motion.text
                        x={w + 8}
                        y={y + BAR_H - 3}
                        fill="#14213D"
                        fontSize="12"
                        fontWeight={row.key === "agentgate" ? 600 : 500}
                        fontFamily="var(--font-mono), ui-monospace, monospace"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : 0.5 + gi * 0.12 + ri * 0.08 }}
                      >
                        {label}
                      </motion.text>
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

function Benchmark({ report, t }: { report: EvalReport; t: T }) {
  const { baseline, agentgate, uplift, intents } = report.benchmark;
  const rows: Array<{ labelKey: EvalKey; value: (s: StoreResult) => string; money?: boolean }> = [
    { labelKey: "metric.conversion", value: (s) => fmtPct(s.conversion_pct) },
    { labelKey: "metric.orders", value: (s) => fmtCount(s.orders) },
    { labelKey: "metric.revenue", value: (s) => formatINR(s.revenue_paise), money: true },
    { labelKey: "metric.avgOrder", value: (s) => formatINR(s.avg_order_paise) },
    { labelKey: "metric.upsell", value: (s) => `${formatINR(s.upsell_paise)} · ${fmtPct(s.upsell_pct)}` },
    { labelKey: "metric.bundles", value: (s) => fmtCount(s.bundles) },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>{t("benchmark.title")}</CardTitle>
          <CardDescription className="mt-1">{t("benchmark.desc", { intents: fmtCount(intents) })}</CardDescription>
        </div>
        <Badge tone="blue">{t("benchmark.intents", { intents: fmtCount(intents) })}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <BenchmarkChart baseline={baseline} agentgate={agentgate} t={t} />

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">{t("table.caption")}</caption>
            <thead>
              <tr className="border-b border-rzp-border text-[11px] font-semibold uppercase tracking-[0.12em] text-rzp-muted">
                <th scope="col" className="py-2 pr-4 text-left font-semibold">
                  {t("table.metric")}
                </th>
                <th scope="col" className="py-2 px-4 text-right font-semibold">
                  {t("table.baseline")}
                </th>
                <th scope="col" className="py-2 pl-4 text-right font-semibold">
                  {t("table.agentgate")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rzp-border">
              {rows.map((row) => (
                <tr key={row.labelKey}>
                  <th scope="row" className="py-2.5 pr-4 text-left font-medium text-rzp-text">
                    {t(row.labelKey)}
                  </th>
                  <td className="py-2.5 px-4 text-right font-mono tnum text-rzp-muted">{row.value(baseline)}</td>
                  <td className={cn("py-2.5 pl-4 text-right font-mono tnum font-semibold", row.money ? "text-[#087443]" : "text-rzp-text")}>{row.value(agentgate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="border-t border-rzp-border pt-3 text-sm text-rzp-muted">
          {t("benchmark.upliftLead")}{" "}
          <span className="font-mono tnum font-semibold text-[#087443]">
            {uplift.revenue_paise > 0 ? "+" : ""}
            {formatINR(uplift.revenue_paise)}
          </span>{" "}
          {t("benchmark.upliftRevenue")} (<span className="font-mono tnum text-rzp-text">{fmtPct(uplift.revenue_pct, { sign: true })}</span>) ·{" "}
          <span className="font-mono tnum text-rzp-text">
            {uplift.conversion_pts > 0 ? "+" : ""}
            {Math.round(uplift.conversion_pts * 10) / 10}
          </span>{" "}
          {t("benchmark.upliftPts")} · <span className="font-mono tnum text-rzp-text">{fmtCount(agentgate.bundles)}</span> {t("benchmark.upliftBundles")}
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Red team                                                           */
/* ------------------------------------------------------------------ */

/** The figure the tour lands on. Re-keyed to write itself in again when the tour asks. */
function BreachFigure({ attacks, breaches, emphasis, t }: { attacks: number; breaches: number; emphasis: number; t: T }) {
  const clean = breaches === 0;
  return (
    <p className={cn("font-display text-3xl font-bold leading-none tracking-tight text-rzp-text sm:text-4xl", emphasis > 0 && "animate-write-in")}>
      <span className="font-mono tnum">{fmtCount(attacks)}</span> {t("redteam.attacks")} <span className="text-rzp-teal">{t("redteam.arrow")}</span>{" "}
      <span className={clean ? "text-[#087443]" : "text-[#B3262C]"}>
        <span className="font-mono tnum">{fmtCount(breaches)}</span> {breaches === 1 ? t("redteam.breach") : t("redteam.breaches")}
      </span>
    </p>
  );
}

function StackedBar({ attacks, caught, breaches, t }: { attacks: number; caught: number; breaches: number; t: T }) {
  const reduce = useReducedMotion();
  const caughtPct = attacks > 0 ? (caught / attacks) * 100 : 0;
  const breachPct = attacks > 0 ? (breaches / attacks) * 100 : 0;
  const uncounted = Math.max(0, attacks - caught - breaches);
  const rest = uncounted > 0 ? t("redteam.unclassifiedPart", { n: fmtCount(uncounted) }) : "";
  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={t("redteam.barLabel", { attacks: fmtCount(attacks), caught: fmtCount(caught), breaches: fmtCount(breaches), rest })}
        className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md bg-rzp-mist2 ring-1 ring-inset ring-rzp-border"
      >
        {caughtPct > 0 ? (
          <motion.div
            className="h-full rounded-l-md bg-gradient-to-r from-rzp-green to-[#0FA65F]"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${caughtPct}%` }}
            transition={{ duration: reduce ? 0 : 0.9, ease: EASE_OUT }}
            title={t("redteam.caughtTitle", { n: fmtCount(caught) })}
          />
        ) : null}
        {breachPct > 0 ? (
          <motion.div
            className="h-full bg-rzp-red"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${breachPct}%` }}
            transition={{ duration: reduce ? 0 : 0.9, ease: EASE_OUT }}
            title={t("redteam.breachesTitle", { n: fmtCount(breaches) })}
          />
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-rzp-muted" aria-hidden="true">
        <li className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rzp-green" /> {t("redteam.caught")}{" "}
          <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(caught)}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rzp-red" /> {t("redteam.breaches")}{" "}
          <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(breaches)}</span>
        </li>
        {uncounted > 0 ? (
          <li className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rzp-border" /> {t("redteam.unclassified")}{" "}
            <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(uncounted)}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function RedTeamHeader({ attacks, breaches, t }: { attacks: number; breaches: number; t: T }) {
  return (
    <CardHeader>
      <div>
        <CardTitle id="red-team-title">{t("redteam.title")}</CardTitle>
        <CardDescription className="mt-1">{t("redteam.desc")}</CardDescription>
      </div>
      <Badge tone={breaches === 0 ? "green" : "red"} dot>
        {t(breaches === 1 ? "redteam.badgeOne" : "redteam.badge", { attacks: fmtCount(attacks), breaches: fmtCount(breaches) })}
      </Badge>
    </CardHeader>
  );
}

const RedTeam = forwardRef<HTMLElement, { report: EvalReport; emphasis: number; t: T }>(function RedTeam({ report, emphasis, t }, ref) {
  const rt = report.red_team;

  return (
    <Reveal amount={0.1}>
      <Card>
        <section ref={ref} aria-labelledby="red-team-title" className="scroll-mt-24">
          <RedTeamHeader attacks={rt.attacks} breaches={rt.breaches} t={t} />
          <CardContent className="space-y-5">
            <BreachFigure key={emphasis} attacks={rt.attacks} breaches={rt.breaches} emphasis={emphasis} t={t} />
            <StackedBar attacks={rt.attacks} caught={rt.caught} breaches={rt.breaches} t={t} />

            <div className="overflow-x-auto scrollbar-thin">
              {rt.by_category.length === 0 ? (
                <p className="py-3 text-sm text-rzp-muted">{t("redteam.none")}</p>
              ) : (
                <table className="w-full min-w-[560px] text-sm">
                  <caption className="sr-only">{t("redteam.table.caption")}</caption>
                  <thead>
                    <tr className="border-b border-rzp-border text-[11px] font-semibold uppercase tracking-[0.12em] text-rzp-muted">
                      <th scope="col" className="py-2 pr-4 text-left font-semibold">
                        {t("redteam.table.category")}
                      </th>
                      <th scope="col" className="py-2 px-3 text-right font-semibold">
                        {t("redteam.table.attempted")}
                      </th>
                      <th scope="col" className="py-2 px-3 text-right font-semibold">
                        {t("redteam.table.caught")}
                      </th>
                      <th scope="col" className="py-2 px-3 text-right font-semibold">
                        {t("redteam.table.breaches")}
                      </th>
                      <th scope="col" className="py-2 pl-3 text-left font-semibold">
                        {t("redteam.table.codes")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rzp-border">
                    {rt.by_category.map((c) => {
                      const top = topReasonCodes(c.reason_codes);
                      return (
                        <tr key={c.category}>
                          <th scope="row" className="py-2.5 pr-4 text-left font-medium text-rzp-text">
                            {t(CATEGORY_KEY[c.category])}
                          </th>
                          <td className="py-2.5 px-3 text-right font-mono tnum text-rzp-muted">{fmtCount(c.attempted)}</td>
                          <td className="py-2.5 px-3 text-right font-mono tnum font-medium text-[#087443]">{fmtCount(c.caught)}</td>
                          <td className={cn("py-2.5 px-3 text-right font-mono tnum", c.breaches > 0 ? "font-semibold text-[#B3262C]" : "text-rzp-muted")}>{fmtCount(c.breaches)}</td>
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
              {t("redteam.controls")} <span className="font-mono tnum font-medium text-rzp-text">{fmtPct(rt.false_block_rate_pct)}</span> {t("redteam.controlsRate")}{" "}
              <span className="font-mono tnum font-medium text-rzp-text">{fmtCount(rt.control_sessions)}</span> {t("redteam.controlsSessions")}
              {rt.control_blocked > 0 ? (
                <>
                  {" "}
                  (<span className="font-mono tnum text-rzp-text">{fmtCount(rt.control_blocked)}</span> {t("redteam.controlsBlocked")})
                </>
              ) : (
                ` ${t("redteam.controlsClean")}`
              )}
            </p>
          </CardContent>
        </section>
      </Card>
    </Reveal>
  );
});

/** What the page can show from /api/stats alone: the headline of the last run, without its tables. */
const HeadlineRedTeam = forwardRef<HTMLElement, { headline: EvalHeadline; emphasis: number; t: T }>(function HeadlineRedTeam({ headline, emphasis, t }, ref) {
  const caught = Math.max(0, headline.attacks - headline.breaches);
  return (
    <Card className="fade-up" style={delay(300)}>
      <section ref={ref} aria-labelledby="red-team-title" className="scroll-mt-24">
        <RedTeamHeader attacks={headline.attacks} breaches={headline.breaches} t={t} />
        <CardContent className="space-y-5">
          <BreachFigure key={emphasis} attacks={headline.attacks} breaches={headline.breaches} emphasis={emphasis} t={t} />
          <StackedBar attacks={headline.attacks} caught={caught} breaches={headline.breaches} t={t} />
          <p className="text-sm text-rzp-muted">
            <span className="font-mono tnum font-medium text-rzp-text">{fmtPct(headline.explained_pct)}</span> {t("redteam.explainedLine")}{" "}
            <span className="font-mono tnum font-medium text-rzp-text">{fmtPct(headline.revenue_uplift_pct, { sign: true })}</span> {t("redteam.upliftLine")}
          </p>
        </CardContent>
      </section>
    </Card>
  );
});

/* ------------------------------------------------------------------ */
/*  Coverage + run meta                                                */
/* ------------------------------------------------------------------ */

function Coverage({ report, t }: { report: EvalReport; t: T }) {
  const c = report.coverage;
  const tile = "rounded-xl border border-rzp-border bg-rzp-mist px-4 py-3";
  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>{t("coverage.title")}</CardTitle>
          <CardDescription className="mt-1">{t("coverage.desc")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Stat bare className={tile} label={t("coverage.reason")} value={fmtPct(c.with_human_reason_pct)} tone={c.with_human_reason_pct >= 100 ? "green" : "amber"} hint={t("coverage.reason.hint")} />
          <Stat bare className={tile} label={t("coverage.check")} value={fmtPct(c.with_policy_check_pct)} tone={c.with_policy_check_pct >= 100 ? "green" : "amber"} hint={t("coverage.check.hint")} />
          <Stat bare className={tile} label={t("coverage.chain")} value={c.chain_intact ? t("coverage.intact") : t("coverage.broken")} tone={c.chain_intact ? "green" : "red"} hint={t("coverage.chain.hint")} />
          <Stat bare className={tile} label={t("coverage.actions")} value={fmtCount(c.money_actions)} hint={t("coverage.actions.hint", { entries: fmtCount(c.ledger_entries) })} />
        </div>
        <p className="mt-4 text-xs text-rzp-muted">
          {t("coverage.openTower.lead")}{" "}
          <Link href="/dashboard" className={buttonClasses({ variant: "ghost", size: "sm", className: "h-6 rounded-full px-2 text-xs" })}>
            {t("coverage.openTower")}
          </Link>{" "}
          {t("coverage.openTower.tail")}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The two questions a sharp judge asks about a zero: can the detector see a
 * breach at all, and what was the guard worth in rupees. Both come straight from
 * the run — nothing here is written by hand.
 */
function Falsification({ report, t }: { report: EvalReport; t: T }) {
  const hc = report.harness_check;
  const econ = report.economics;
  if (!hc && !econ) return null;
  const th = "px-3 pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-rzp-muted";
  const td = "px-3 py-2 align-middle";

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {hc ? (
        <Card className="h-full">
          <CardHeader>
            <div>
              <CardTitle>{t("selftest.title")}</CardTitle>
              <CardDescription className="mt-1">{t("selftest.desc")}</CardDescription>
            </div>
            <Badge tone={hc.sound ? "green" : "red"} dot className="shrink-0">
              {hc.sound ? t("selftest.sound") : t("selftest.unsound")}
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="mb-3 font-mono text-sm tnum text-rzp-text">
              {t("selftest.score", { detected: hc.detected, total: hc.mutations })}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="border-b border-rzp-border">
                    <th scope="col" className={th}>{t("selftest.th.guard")}</th>
                    <th scope="col" className={th}>{t("selftest.th.attack")}</th>
                    <th scope="col" className={th}>{t("selftest.th.seen")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rzp-border">
                  {hc.detail.map((m) => (
                    <tr key={m.id}>
                      <td className={td}>{m.label}</td>
                      <td className={cn(td, "font-mono text-xs text-rzp-muted")}>{m.attack_id}</td>
                      <td className={td}>
                        <Badge tone={m.detected ? "green" : "red"}>{m.detected ? t("selftest.seen") : t("selftest.blind")}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-rzp-muted">{t("selftest.note")}</p>
          </CardContent>
        </Card>
      ) : null}

      {econ ? (
        <Card className="h-full">
          <CardHeader>
            <div>
              <CardTitle>{t("econ.title")}</CardTitle>
              <CardDescription className="mt-1">{t("econ.desc")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="border-b border-rzp-border">
                    <th scope="col" className={th}>{t("econ.th.shop")}</th>
                    <th scope="col" className={cn(th, "text-right")}>{t("econ.th.against")}</th>
                    <th scope="col" className={cn(th, "text-right")}>{t("econ.th.earned")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rzp-border">
                  <tr>
                    <td className={td}>{t("econ.allow")}</td>
                    <td className={cn(td, "text-right font-mono tnum text-[#B3262C]")}>{formatINR(econ.refused_paise)}</td>
                    <td className={cn(td, "text-right font-mono tnum")}>{formatINR(econ.earned_paise)}</td>
                  </tr>
                  <tr>
                    <td className={td}>{t("econ.block")}</td>
                    <td className={cn(td, "text-right font-mono tnum")}>₹0</td>
                    <td className={cn(td, "text-right font-mono tnum text-[#B3262C]")}>₹0</td>
                  </tr>
                  <tr className="bg-rzp-ice/60">
                    <td className={cn(td, "font-semibold")}>{t("econ.us")}</td>
                    <td className={cn(td, "text-right font-mono font-semibold tnum text-[#087443]")}>₹0</td>
                    <td className={cn(td, "text-right font-mono font-semibold tnum text-[#087443]")}>
                      {formatINR(econ.earned_paise - econ.false_block_paise)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-rzp-muted">{t("econ.note", { gated: formatINR(econ.gated_paise) })}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function RunMeta({ report, source, t, locale }: { report: EvalReport; source: ReportSource; t: T; locale: "en" | "hi" }) {
  const via = source === "db" ? t("meta.viaDb") : source === "file" ? t("meta.viaFile") : null;
  return (
    <div className="space-y-2 text-xs text-rzp-muted">
      <p>{t("caveat")}</p>
      <p className="font-mono tnum">
        {t("meta.lastRun")} <time dateTime={report.ran_at}>{fmtWhen(report.ran_at, locale)}</time> · {t("meta.seed")} {report.seed} · {Math.round(report.duration_ms / 100) / 10}s ·{" "}
        {t("meta.seller")} {report.modes.llm} · {t("meta.payments")} {report.modes.payments} · {t("meta.search")} {report.modes.search}
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
