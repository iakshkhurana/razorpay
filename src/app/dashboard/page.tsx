"use client";

import confetti from "canvas-confetti";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AgentVoiceToggle } from "@/components/AgentVoiceToggle";
import { AppShell } from "@/components/AppShell";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { FloatingCard, LedgerStamp } from "@/components/illustrations";
import { LedgerBook, type LedgerView } from "@/components/LedgerBook";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, SkeletonLines } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  api,
  runScriptedOrder,
  sleep,
  type LedgerEntryView,
  type LedgerResponse,
  type OrderView,
  type StatsResponse,
} from "@/lib/demo/client";
import { localeOfText, useLocale, useT, voiceLangFor, type Locale, type Translator } from "@/lib/i18n/core";
import { common } from "@/lib/i18n/strings/common";
import { dashboard, type DashboardKey } from "@/lib/i18n/strings/dashboard";
import { formatINR } from "@/lib/money";
import { isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";
import { useAgentVoice } from "@/lib/voice/useAgentVoice";

const POLL_MS = 2000;
const RECENT_LIMIT = 6;
/** how long the summary card stays after the voice finishes */
const SUMMARY_LINGER_MS = 7000;
/* brand blue, money green, owner's-call violet, teal and one saffron spark */
const CONFETTI_COLORS = ["#2F6BFF", "#12B76A", "#7C5CFF", "#17A9CC", "#FF7A1A"];

type T = Translator<DashboardKey>;

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** One soft burst when money actually moves. Silent under reduced motion. */
function burstConfetti(): void {
  if (prefersReducedMotion()) return;
  try {
    void confetti({
      particleCount: 70,
      spread: 60,
      startVelocity: 28,
      gravity: 0.9,
      ticks: 160,
      origin: { x: 0.5, y: 0.35 },
      colors: CONFETTI_COLORS,
    });
  } catch {
    /* a missing canvas is not worth an error on the merchant's screen */
  }
}

function shortHash(h: string): string {
  if (!h || h.length < 12) return "—";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

/** "ord_mtfyplx7_virq79" → "ord…virq79" — enough to match against the book. */
function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 3)}…${id.slice(-6)}`;
}

function fadeUp(delayMs: number): CSSProperties {
  return { "--delay": `${delayMs}ms` } as CSSProperties;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  PAID: "green",
  AWAITING_PAYMENT: "blue",
  PENDING_APPROVAL: "violet",
  HELD: "amber",
  FAILED: "red",
  REJECTED: "red",
  DRAFT: "gray",
};

type CommonT = Translator<keyof typeof common.en>;

function statusPill(order: OrderView, t: T, tc: CommonT): { tone: BadgeTone; label: string } {
  if (order.held_recovering) return { tone: "amber", label: t("orders.status.recovering") };
  if (order.status === "PENDING_APPROVAL") return { tone: "violet", label: t("orders.status.ownersCall") };
  const key = `status.order.${order.status}` as keyof typeof common.en;
  const known = key in common.en;
  return { tone: STATUS_TONE[order.status] ?? "gray", label: known ? tc(key) : order.status };
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function RupeeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 5h10M7 9h10M8 5h3a4 4 0 0 1 0 8H7l7 7" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 17.5 9.5 11l4 4 7-7.5" />
      <path d="M15.5 7.5h5v5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="M9.5 12h5M12 9.5v5" />
    </svg>
  );
}

function ChainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.8" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  ?paid=<order_id> — the payment page sends the buyer back here      */
/* ------------------------------------------------------------------ */

function PaidNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const t = useT(dashboard);
  const announced = useRef(false);
  const paid = params.get("paid");

  useEffect(() => {
    if (!paid || announced.current) return;
    announced.current = true;
    toast(t("paid.toast", { id: paid }), "money");
    burstConfetti();
    const next = new URLSearchParams(params.toString());
    next.delete("paid");
    const qs = next.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
  }, [paid, params, router, toast, t]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Spoken day summary                                                 */
/* ------------------------------------------------------------------ */

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "speaking" | "done" | "muted"; text: string; lang: Locale };

/** Five bars that dance while the voice speaks; a quiet row otherwise. */
function Equalizer({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const peaks = [0.55, 0.95, 0.7, 1, 0.6];
  const animated = active && !reduce;
  return (
    <span className="flex h-7 items-end gap-[3px]" aria-hidden="true">
      {peaks.map((peak, i) => (
        <motion.span
          key={i}
          className="block h-7 w-[4px] rounded-full bg-gradient-to-t from-rzp-blue to-rzp-cyan"
          style={{ originY: 1 }}
          animate={animated ? { scaleY: [0.22, peak, 0.38, peak * 0.82, 0.22] } : { scaleY: active ? 0.55 : 0.22 }}
          transition={animated ? { duration: 0.95 + i * 0.09, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        />
      ))}
    </span>
  );
}

interface SummaryCardProps {
  state: SummaryState;
  provider: "sarvam" | "browser" | "none";
  onStop: () => void;
  onReplay: () => void;
  onClose: () => void;
}

function SummaryCard({ state, provider, onStop, onReplay, onClose }: SummaryCardProps) {
  const t = useT(dashboard);
  const reduce = useReducedMotion();
  if (state.status === "idle") return null;

  const speaking = state.status === "speaking";
  const hasText = state.status === "speaking" || state.status === "done" || state.status === "muted";
  const statusLine =
    state.status === "loading"
      ? t("summary.loading")
      : state.status === "error"
        ? t("summary.error")
        : state.status === "speaking"
          ? t("summary.speaking")
          : state.status === "done"
            ? t("summary.done")
            : provider === "none"
              ? t("summary.noVoice")
              : t("summary.voiceOff");

  return (
    <motion.section
      key="summary"
      aria-label={t("summary.title")}
      aria-live="polite"
      initial={{ opacity: 0, y: reduce ? 0 : -8, scale: reduce ? 1 : 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduce ? 0 : -6, scale: reduce ? 1 : 0.985 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
      className="mb-6 overflow-hidden rounded-2xl border border-rzp-blue/20 bg-white shadow-card"
    >
      <div className="h-1 w-full bg-gradient-to-r from-rzp-saffron via-rzp-blue to-rzp-cyan" aria-hidden="true" />
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rzp-ice ring-1 ring-rzp-border">
          <Equalizer active={speaking} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rzp-blueDeep">{t("summary.title")}</p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                state.status === "error"
                  ? "border-rzp-red/30 bg-rzp-red/10 text-[#B3262C]"
                  : speaking
                    ? "border-rzp-teal/35 bg-rzp-teal/10 text-[#0B6B84]"
                    : "border-rzp-border bg-rzp-mist2 text-rzp-muted",
              )}
              role="status"
            >
              {speaking ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rzp-teal animate-dot-pulse" /> : null}
              {statusLine}
            </span>
          </div>
          {hasText ? (
            <p lang={state.lang} className="mt-2 font-display text-lg font-semibold leading-snug tracking-tight text-rzp-text sm:text-xl">
              {state.text}
            </p>
          ) : state.status === "loading" ? (
            <SkeletonLines lines={2} className="mt-3 max-w-xl" />
          ) : null}
          {hasText ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {speaking ? (
                <Button size="sm" variant="secondary" onClick={onStop}>
                  {t("summary.stop")}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={onReplay}>
                  <SpeakerIcon />
                  {t("summary.replay")}
                </Button>
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("summary.close")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-rzp-muted transition-colors hover:bg-rzp-mist hover:text-rzp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2"
        >
          <CloseIcon />
        </button>
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI row                                                            */
/* ------------------------------------------------------------------ */

function KpiRow({ stats, evalRun }: { stats: StatsResponse["stats"] | null; evalRun: StatsResponse["eval"] }) {
  const t = useT(dashboard);
  const loading = stats === null;
  const intact = stats?.ledger_intact ?? true;
  const upsellPct = stats?.upsell_pct ?? 0;
  const pending = stats?.pending_approvals ?? 0;
  const uplift = evalRun?.revenue_uplift_pct ?? null;

  return (
    <section aria-label={t("kpi.section")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        className="fade-up"
        style={fadeUp(0)}
        label={t("kpi.revenue")}
        value={formatINR(stats?.revenue_paise ?? 0)}
        delta={
          uplift !== null && (stats?.revenue_paise ?? 0) > 0
            ? { label: t("kpi.revenue.delta", { pct: `${uplift > 0 ? "+" : ""}${uplift}` }), direction: uplift > 0 ? "up" : uplift < 0 ? "down" : "flat" }
            : undefined
        }
        hint={stats ? (stats.orders_paid === 1 ? t("kpi.revenue.hint.one") : t("kpi.revenue.hint.many", { n: stats.orders_paid })) : " "}
        tone="green"
        icon={<RupeeIcon />}
        loading={loading}
      />
      <Stat
        className="fade-up"
        style={fadeUp(80)}
        label={t("kpi.upsell")}
        value={formatINR(stats?.upsell_paise ?? 0)}
        delta={{ label: `${upsellPct > 0 ? "+" : ""}${upsellPct}%`, direction: upsellPct > 0 ? "up" : "flat" }}
        hint={t("kpi.upsell.hint")}
        tone="blue"
        icon={<TrendIcon />}
        loading={loading}
      />
      <Stat
        className="fade-up"
        style={fadeUp(160)}
        label={t("kpi.guarded")}
        value={String(stats?.actions_guarded ?? 0)}
        delta={{
          label: pending === 0 ? t("kpi.guarded.delta.none") : pending === 1 ? t("kpi.guarded.delta.one") : t("kpi.guarded.delta.many", { n: pending }),
          direction: "flat",
        }}
        hint={<span className="font-mono tracking-wide">COUNTER + GATE + DENY</span>}
        tone="amber"
        icon={<ShieldIcon />}
        loading={loading}
      />
      <Stat
        className="fade-up"
        style={fadeUp(240)}
        label={t("kpi.integrity")}
        value={<span className="font-display text-2xl">{intact ? t("kpi.intact") : t("kpi.tampered", { n: stats?.ledger_broken_at ?? "?" })}</span>}
        delta={{ label: intact ? t("kpi.integrity.delta") : t("kpi.integrity.deltaBroken"), direction: intact ? "up" : "down" }}
        hint={<span className="font-mono tnum">{t("kpi.integrity.hint", { hash: shortHash(stats?.head_hash ?? ""), n: stats?.ledger_count ?? 0 })}</span>}
        tone={intact ? "green" : "red"}
        icon={<ChainIcon />}
        loading={loading}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  The book                                                           */
/* ------------------------------------------------------------------ */

const VIEWS: readonly LedgerView[] = ["shopkeeper", "tech"];

function ViewSwitch({ view, onChange }: { view: LedgerView; onChange: (next: LedgerView) => void }) {
  const t = useT(dashboard);
  const groupRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, current: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % VIEWS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = VIEWS.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(VIEWS[next]);
    groupRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  return (
    <div ref={groupRef} role="group" aria-label={t("book.view")} className="inline-flex rounded-lg bg-rzp-mist2 p-0.5">
      {VIEWS.map((key, i) => {
        const active = view === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "h-7 rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
              active ? "bg-white text-rzp-blueDeep shadow-sm" : "text-rzp-muted hover:text-rzp-text",
            )}
          >
            {key === "shopkeeper" ? t("book.shopkeeper") : t("book.tech")}
          </button>
        );
      })}
    </div>
  );
}

interface LedgerState {
  entries: LedgerEntryView[];
  chain: LedgerResponse["chain"];
}

/** Development-only: edits the newest money row so the chain badge flips ✗ — the tamper-detection demo. */
function TamperDemoButton() {
  const t = useT(dashboard);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch("/api/dev/tamper", { method: "POST" });
          toast(res.ok ? t("book.tamperDone") : t("book.tamperFailed"), res.ok ? "deny" : "ink");
        } catch {
          toast(t("book.tamperFailed"), "ink");
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex h-8 items-center rounded-lg border border-dashed border-rzp-red/50 bg-white px-2.5 text-xs font-medium text-[#B3262C] transition-colors hover:bg-rzp-red/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 disabled:opacity-50"
    >
      {t("book.tamper")}
    </button>
  );
}

function TheBook({ ledger, view, onView }: { ledger: LedgerState | null; view: LedgerView; onView: (next: LedgerView) => void }) {
  const t = useT(dashboard);
  const chain = ledger?.chain ?? null;
  const entries = ledger?.entries ?? [];
  const empty = ledger !== null && entries.length === 0;

  return (
    <section className="min-w-0 lg:col-span-2" aria-labelledby="ledger-heading">
      <Card className="fade-up overflow-hidden" style={fadeUp(320)} aria-busy={ledger === null || undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rzp-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="ledger-heading" className="font-display text-lg font-semibold tracking-tight text-rzp-text">
              {t("book.title")}
            </h2>
            <p className="text-xs text-rzp-muted">{t("book.desc")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {chain ? (
              <>
                <Badge tone="gray" className="font-mono tnum">
                  {chain.count === 1 ? t("book.entries.one") : t("book.entries.many", { n: chain.count })}
                </Badge>
                <Badge tone={chain.intact ? "green" : "red"} dot aria-live="polite">
                  {chain.intact ? t("book.chainOk") : t("book.chainBroken", { n: chain.broken_at ?? "?" })}
                </Badge>
              </>
            ) : (
              <Skeleton className="h-6 w-36 rounded-full" />
            )}
            <a
              href="/api/ledger/export"
              download
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rzp-border bg-white px-2.5 text-xs font-medium text-rzp-text transition-colors hover:border-rzp-blue hover:text-rzp-blueDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2"
            >
              {t("book.export")}
            </a>
            {process.env.NODE_ENV === "development" ? <TamperDemoButton /> : null}
            <ViewSwitch view={view} onChange={onView} />
          </div>
        </div>

        <div aria-live="polite" aria-label={t("book.feed")}>
          {ledger === null ? (
            <div className="ledger-spine ruled-paper pl-[6px]">
              <div className="px-5 py-6">
                <p className="text-sm text-rzp-muted">{t("book.opening")}</p>
                <SkeletonLines lines={4} className="mt-4" />
              </div>
            </div>
          ) : empty ? (
            <div className="ledger-spine ruled-paper pl-[6px]">
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <LedgerStamp className="w-56" title={t("book.empty.art")} />
                <p className="mt-4 text-base font-medium text-rzp-text">{t("book.empty.title")}</p>
                <p className="mt-1 max-w-md text-sm text-rzp-muted">{t("book.empty.desc")}</p>
                <Link href="/simulator" className={buttonClasses({ variant: "primary", size: "sm", className: "mt-4" })}>
                  {t("book.empty.cta")}
                </Link>
              </div>
            </div>
          ) : (
            <LedgerBook entries={entries} view={view} maxHeight="62vh" className="rounded-none border-0 bg-transparent" />
          )}
        </div>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Recent orders                                                      */
/* ------------------------------------------------------------------ */

function RecentOrders({ orders, loaded }: { orders: OrderView[]; loaded: boolean }) {
  const t = useT(dashboard);
  const tc = useT(common);
  const rows = useMemo(
    () =>
      [...orders]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
        .slice(0, RECENT_LIMIT),
    [orders],
  );

  return (
    <section aria-labelledby="recent-orders-heading">
      <Card aria-busy={!loaded || undefined}>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle id="recent-orders-heading">{t("orders.title")}</CardTitle>
            <CardDescription className="mt-0.5">{t("orders.desc")}</CardDescription>
          </div>
          {loaded && orders.length > RECENT_LIMIT ? (
            <Badge tone="gray" className="shrink-0">
              {t("orders.total", { n: orders.length })}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className={cn(loaded && rows.length > 0 && "px-0 pb-2")}>
          {!loaded ? (
            <SkeletonLines lines={4} />
          ) : rows.length === 0 ? (
            <div className="flex items-center gap-4">
              <FloatingCard className="w-24 shrink-0" title={t("orders.empty.art")} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-rzp-text">{t("orders.empty.title")}</p>
                <p className="mt-1 text-sm text-rzp-muted">{t("orders.empty.desc")}</p>
                <Link href="/simulator" className="mt-1 inline-block text-sm font-medium text-rzp-blueDeep underline-offset-4 hover:underline">
                  {t("orders.empty.cta")} →
                </Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-rzp-muted">
                    <th scope="col" className="px-5 pb-2 font-semibold">
                      {t("orders.col.order")}
                    </th>
                    <th scope="col" className="pb-2 pr-3 font-semibold">
                      {t("orders.col.items")}
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-semibold">
                      {t("orders.col.amount")}
                    </th>
                    <th scope="col" className="pb-2 pr-5 text-right font-semibold">
                      {t("orders.col.status")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rzp-border">
                  {rows.map((order) => {
                    const pill = statusPill(order, t, tc);
                    const items = order.sku_names.length > 0 ? order.sku_names.join(" + ") : order.sku_ids.join(", ");
                    return (
                      <tr key={order.id} className="align-middle transition-colors hover:bg-rzp-mist">
                        <td className="px-5 py-2.5 font-mono text-xs text-rzp-text" title={order.id}>
                          {shortId(order.id)}
                        </td>
                        <td className="max-w-[11rem] truncate py-2.5 pr-3 text-rzp-text" title={items}>
                          {items}
                          {order.qty > 1 ? <span className="text-rzp-muted"> × {order.qty}</span> : null}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 text-right font-mono tnum text-rzp-text">{formatINR(order.amount_paise)}</td>
                        <td className="py-2.5 pr-5 text-right">
                          <Badge tone={pill.tone} dot>
                            {pill.label}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  The Control Tower                                                  */
/* ------------------------------------------------------------------ */

function Dashboard() {
  const t = useT(dashboard);
  const { locale } = useLocale();
  const { toast } = useToast();
  const voice = useAgentVoice();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerState | null>(null);
  const [pending, setPending] = useState<OrderView[]>([]);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [view, setView] = useState<LedgerView>("shopkeeper");
  const [error, setError] = useState<string | null>(null);
  const [tourNote, setTourNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({ status: "idle" });

  const viewRef = useRef<LedgerView>("shopkeeper");
  const inFlight = useRef(false);
  /** bumps on every refresh; a response from an older refresh is ignored */
  const refreshSeq = useRef(0);
  /** ids seen on the previous poll; null until the first ledger answer */
  const seenLedger = useRef<Set<string> | null>(null);
  /** tour steps run one after another, never dropped, never overlapping */
  const tourQueue = useRef<Promise<void>>(Promise.resolve());
  /** bumps when a newer summary request or a close supersedes the running one */
  const summarySeq = useRef(0);
  /** the translator the async tour handlers read, so they follow a language switch without resubscribing */
  const tRef = useRef<T>(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const held = useMemo(() => orders.filter((x) => x.held_recovering || x.status === "HELD"), [orders]);
  const voiceAvailable = voice.supported || voice.provider === "sarvam";

  /* ---------------- Polling ---------------- */

  const applyLedger = useCallback((res: LedgerResponse) => {
    if (res.view !== viewRef.current) return;
    setLedger({ entries: res.entries, chain: res.chain });
    const seen = seenLedger.current;
    if (seen !== null) {
      const paidArrived = res.entries.some((e) => e.verdict === "PAID" && !seen.has(e.id));
      if (paidArrived) burstConfetti();
    }
    seenLedger.current = new Set(res.entries.map((e) => e.id));
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (inFlight.current && !force) return;
      inFlight.current = true;
      refreshSeq.current += 1;
      const seq = refreshSeq.current;
      try {
        const results = await Promise.allSettled([
          api.stats(),
          api.ledger(viewRef.current, 100),
          api.orders("PENDING_APPROVAL"),
          api.orders(),
        ]);
        if (seq !== refreshSeq.current) return;
        const [s, l, p, o] = results;
        if (s.status === "fulfilled") setStats(s.value);
        if (l.status === "fulfilled") applyLedger(l.value);
        if (p.status === "fulfilled") setPending(p.value.orders);
        if (o.status === "fulfilled") setOrders(o.value.orders);
        if (p.status === "fulfilled" && o.status === "fulfilled") setOrdersLoaded(true);
        setError(results.some((r) => r.status === "rejected") ? tRef.current("error.reach") : null);
      } finally {
        if (seq === refreshSeq.current) inFlight.current = false;
      }
    },
    [applyLedger],
  );

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const changeView = useCallback(
    (next: LedgerView) => {
      if (next === viewRef.current) return;
      viewRef.current = next;
      setView(next);
      void refresh(true);
    },
    [refresh],
  );

  /* ---------------- Day summary ---------------- */

  /** Hindi text goes to the hi-IN voice, English to en-IN; the card shows the line while it plays. */
  async function speakText(text: string, lang: Locale, seq: number) {
    voice.stop();
    setSummary({ status: "speaking", text, lang });
    await voice.speak(text, voiceLangFor(lang));
    if (seq !== summarySeq.current) return;
    setSummary({ status: "done", text, lang });
  }

  async function playSummary() {
    if (!stats) {
      toast(t("toast.statsPending"));
      return;
    }
    summarySeq.current += 1;
    const seq = summarySeq.current;
    setSummary({ status: "loading" });
    let text: string;
    try {
      const res = await api.summary(locale);
      text = res.text;
    } catch {
      if (seq === summarySeq.current) setSummary({ status: "error" });
      return;
    }
    if (seq !== summarySeq.current) return;
    const lang = localeOfText(text);
    if (!voiceAvailable || !voice.enabled) {
      setSummary({ status: "muted", text, lang });
      return;
    }
    await speakText(text, lang, seq);
  }

  function replaySummary() {
    if (summary.status !== "done" && summary.status !== "muted") return;
    if (!voiceAvailable || !voice.enabled) {
      setSummary({ status: "muted", text: summary.text, lang: summary.lang });
      return;
    }
    summarySeq.current += 1;
    void speakText(summary.text, summary.lang, summarySeq.current);
  }

  function stopSummary() {
    summarySeq.current += 1;
    voice.stop();
    if (summary.status === "speaking") setSummary({ status: "done", text: summary.text, lang: summary.lang });
  }

  function closeSummary() {
    summarySeq.current += 1;
    voice.stop();
    setSummary({ status: "idle" });
  }

  useEffect(() => {
    if (summary.status !== "done") return;
    const timer = window.setTimeout(() => setSummary({ status: "idle" }), SUMMARY_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [summary]);

  /* ---------------- Grand Tour steps 8 and 9 ---------------- */

  const playGate = useCallback(async () => {
    const res = await runScriptedOrder({
      cap_paise: 800_000,
      lines: ["I'd like a Banarasi silk saree for a wedding", "Yes, go ahead."],
    });
    const order = res.order;
    if (!order) {
      setTourNote(tRef.current("tour.noGate"));
      return;
    }
    await refresh(true);
    await sleep(2500);
    if (order.status === "PENDING_APPROVAL") {
      await api.decide({ order_id: order.id, decision: "approve" });
      await refresh(true);
      await sleep(1500);
    }
    await api.simulateWebhook({ order_id: order.id, outcome: "success" });
    await refresh(true);
  }, [refresh]);

  const playFailure = useCallback(async () => {
    // Naming the saree keeps catalog ranking deterministic: the bare "gift for mom" query can tie
    // with the ₹2,799 Zari saree, which turns this step into a COUNTER instead of a paid order.
    const res = await runScriptedOrder({
      cap_paise: 200_000,
      lines: ["anniversary gift for mom, budget ₹2000 — a cotton handloom saree would be lovely", "Yes, that works — I'll take it."],
    });
    const order = res.order;
    if (!order) {
      setTourNote(tRef.current("tour.noGift"));
      return;
    }
    if (order.status !== "AWAITING_PAYMENT") {
      setTourNote(tRef.current("tour.giftStatus", { status: order.status }));
      return;
    }
    await refresh(true);
    await sleep(1500);
    await api.simulateWebhook({ order_id: order.id, outcome: "failure" });
    await refresh(true);
    await sleep(3000);
    await api.simulateWebhook({ order_id: order.id, outcome: "success" });
    await refresh(true);
  }, [refresh]);

  const onTour = useCallback(
    ({ action }: TourEventDetail) => {
      if (!isTourActive()) return;
      if (action !== "dashboard:gate" && action !== "dashboard:failure") return;
      const play = action === "dashboard:gate" ? playGate : playFailure;
      tourQueue.current = tourQueue.current.then(async () => {
        setTourNote(null);
        try {
          await play();
        } catch (err) {
          setTourNote(err instanceof ApiError ? err.message : tRef.current("tour.error"));
        }
      });
    },
    [playGate, playFailure],
  );
  useTourAction(onTour);

  /* ---------------- Render ---------------- */

  const merchantName = stats?.merchant?.name ?? t("badge.shop");
  const summaryBusy = summary.status === "loading";

  const actions = (
    <>
      <AgentVoiceToggle />
      <Button variant="secondary" size="sm" onClick={() => void playSummary()} loading={summaryBusy} aria-pressed={summary.status === "speaking"}>
        {summaryBusy ? null : <SpeakerIcon />}
        {summaryBusy ? t("action.summaryBusy") : t("action.summary")}
      </Button>
      <Link href="/dashboard?tour=1" className={buttonClasses({ variant: "primary", size: "sm" })}>
        {t("action.tour")}
      </Link>
    </>
  );

  const headerExtra = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {stats ? (
          <>
            <Badge tone={stats.merchant?.live ? "green" : "gray"} dot>
              {stats.merchant?.live ? t("badge.live", { name: merchantName }) : t("badge.offline", { name: merchantName })}
            </Badge>
            {stats.stats.pending_approvals > 0 ? (
              <Badge tone="violet" dot>
                {stats.stats.pending_approvals === 1 ? t("badge.pending.one") : t("badge.pending.many", { n: stats.stats.pending_approvals })}
              </Badge>
            ) : null}
            {stats.stats.held_orders > 0 ? (
              <Badge tone="amber" dot>
                {stats.stats.held_orders === 1 ? t("badge.held.one") : t("badge.held.many", { n: stats.stats.held_orders })}
              </Badge>
            ) : null}
          </>
        ) : (
          <Skeleton className="h-6 w-44 rounded-full" />
        )}
      </div>
      {error ? (
        <p className="text-sm text-[#B3262C]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <AppShell
      section="tower"
      title={t("page.title")}
      subtitle={t("page.subtitle")}
      actions={actions}
      headerExtra={headerExtra}
      voice={voiceAvailable ? voice.enabled : undefined}
    >
      <AnimatePresence initial={false}>
        {summary.status !== "idle" ? (
          <SummaryCard key="summary" state={summary} provider={voice.provider} onStop={stopSummary} onReplay={replaySummary} onClose={closeSummary} />
        ) : null}
      </AnimatePresence>

      <KpiRow stats={stats?.stats ?? null} evalRun={stats?.eval ?? null} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <TheBook ledger={ledger} view={view} onView={changeView} />

        <aside className="min-w-0 space-y-6 fade-up" style={fadeUp(400)}>
          <ApprovalQueue pending={pending} held={held} loaded={ordersLoaded} onChanged={() => refresh(true)} />
          <RecentOrders orders={orders} loaded={ordersLoaded} />
        </aside>
      </div>

      {tourNote ? (
        <p className="mt-6 text-sm text-[#B3262C]" role="status">
          {tourNote}
        </p>
      ) : null}

      <Suspense fallback={null}>
        <PaidNotice />
      </Suspense>
    </AppShell>
  );
}

export default function DashboardPage() {
  return <Dashboard />;
}
