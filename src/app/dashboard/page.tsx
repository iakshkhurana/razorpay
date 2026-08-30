"use client";

import confetti from "canvas-confetti";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AgentVoiceToggle } from "@/components/AgentVoiceToggle";
import { AppShell } from "@/components/AppShell";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { LedgerStamp } from "@/components/illustrations";
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
import { formatINR } from "@/lib/money";
import { isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";
import { useAgentVoice } from "@/lib/voice/useAgentVoice";

const POLL_MS = 2000;
const CONFETTI_COLORS = ["#3395FF", "#12B76A", "#7C5CFF", "#0B1D3A"];
const REACH_ERROR = "Could not reach the shop. Retrying every 2 seconds — check that the app is running.";
const RECENT_LIMIT = 6;

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

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}

/** Two Hinglish lines for the voice; hi-IN voices read "1,849 rupaye" more reliably than the ₹ glyph. */
function spokenSummary(s: StatsResponse["stats"]): string {
  const rupaye = (paise: number) => `${formatINR(paise).replace("₹", "")} rupaye`;
  const guarded = s.actions_guarded === 1 ? "1 action roka gaya" : `${s.actions_guarded} actions rok liye gaye`;
  const ledger = s.ledger_intact ? "ledger bilkul sahi hai" : `ledger mein entry number ${s.ledger_broken_at ?? 0} par gadbad hai`;
  return `Aaj AI ne ${rupaye(s.revenue_paise)} ki bikri ki, ${rupaye(s.upsell_paise)} ka upsell. ${guarded}, ${ledger}.`;
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

const STATUS_TONE: Record<string, { tone: BadgeTone; label: string }> = {
  PAID: { tone: "green", label: "Paid" },
  AWAITING_PAYMENT: { tone: "blue", label: "Awaiting payment" },
  PENDING_APPROVAL: { tone: "violet", label: "Owner's call" },
  HELD: { tone: "amber", label: "Held" },
  FAILED: { tone: "red", label: "Failed" },
  REJECTED: { tone: "red", label: "Rejected" },
  DRAFT: { tone: "gray", label: "Draft" },
};

function statusPill(order: OrderView): { tone: BadgeTone; label: string } {
  if (order.held_recovering) return { tone: "amber", label: "Recovering" };
  return STATUS_TONE[order.status] ?? { tone: "gray", label: order.status };
}

/* ------------------------------------------------------------------ */
/*  Icons for the KPI tiles                                            */
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

/* ------------------------------------------------------------------ */
/*  ?paid=<order_id> — the payment page sends the buyer back here      */
/* ------------------------------------------------------------------ */

function PaidNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const announced = useRef(false);
  const paid = params.get("paid");

  useEffect(() => {
    if (!paid || announced.current) return;
    announced.current = true;
    toast(`Payment received for order ${paid}`, "money");
    burstConfetti();
    const next = new URLSearchParams(params.toString());
    next.delete("paid");
    const qs = next.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
  }, [paid, params, router, toast]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  KPI row                                                            */
/* ------------------------------------------------------------------ */

function KpiRow({ stats }: { stats: StatsResponse["stats"] | null }) {
  const loading = stats === null;
  const intact = stats?.ledger_intact ?? true;
  const upsellPct = stats?.upsell_pct ?? 0;

  return (
    <section aria-label="Today's numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        className="fade-up"
        style={fadeUp(0)}
        label="Revenue via AI"
        value={formatINR(stats?.revenue_paise ?? 0)}
        hint={stats ? (stats.orders_paid === 1 ? "1 order paid" : `${stats.orders_paid} orders paid`) : " "}
        tone="green"
        icon={<RupeeIcon />}
        loading={loading}
      />
      <Stat
        className="fade-up"
        style={fadeUp(80)}
        label="Upsell uplift"
        value={formatINR(stats?.upsell_paise ?? 0)}
        delta={{ label: `${upsellPct > 0 ? "+" : ""}${upsellPct}%`, direction: upsellPct > 0 ? "up" : "flat" }}
        hint="of revenue from bundles"
        tone="blue"
        icon={<TrendIcon />}
        loading={loading}
      />
      <Stat
        className="fade-up"
        style={fadeUp(160)}
        label="Actions guarded"
        value={String(stats?.actions_guarded ?? 0)}
        hint={<span className="font-mono tracking-wide">COUNTER + GATE + DENY</span>}
        tone="amber"
        icon={<ShieldIcon />}
        loading={loading}
      />
      <Stat
        className="fade-up"
        style={fadeUp(240)}
        label="Ledger integrity"
        value={intact ? "✓ Intact" : `✗ Tampered at #${stats?.ledger_broken_at ?? "?"}`}
        hint={
          <span className="font-mono tnum">
            head {shortHash(stats?.head_hash ?? "")} · {stats?.ledger_count ?? 0} entries
          </span>
        }
        tone={intact ? "green" : "red"}
        icon={<ChainIcon />}
        loading={loading}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Recent orders                                                      */
/* ------------------------------------------------------------------ */

function RecentOrders({ orders, loaded }: { orders: OrderView[]; loaded: boolean }) {
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
            <CardTitle id="recent-orders-heading">Recent orders</CardTitle>
            <CardDescription className="mt-0.5">Every order the agents placed, latest first.</CardDescription>
          </div>
          {loaded && orders.length > RECENT_LIMIT ? (
            <Badge tone="gray" className="shrink-0">
              {orders.length} total
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className={cn(loaded && rows.length > 0 && "px-0 pb-2")}>
          {!loaded ? (
            <SkeletonLines lines={4} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-rzp-muted">
              No orders yet.{" "}
              <Link href="/simulator" className="font-medium text-rzp-blueDeep underline-offset-4 hover:underline">
                Run the demo buyer
              </Link>{" "}
              and the first one lands here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-rzp-muted">
                    <th scope="col" className="px-5 pb-2 font-semibold">
                      Order
                    </th>
                    <th scope="col" className="pb-2 pr-3 font-semibold">
                      Items
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-semibold">
                      Amount
                    </th>
                    <th scope="col" className="pb-2 pr-5 text-right font-semibold">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rzp-border">
                  {rows.map((order) => {
                    const pill = statusPill(order);
                    const items = order.sku_names.length > 0 ? order.sku_names.join(" + ") : order.sku_ids.join(", ");
                    return (
                      <tr key={order.id} className="align-middle">
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

interface LedgerState {
  entries: LedgerEntryView[];
  chain: LedgerResponse["chain"];
}

function Dashboard() {
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

  const viewRef = useRef<LedgerView>("shopkeeper");
  const inFlight = useRef(false);
  /** bumps on every refresh; a response from an older refresh is ignored */
  const refreshSeq = useRef(0);
  /** ids seen on the previous poll; null until the first ledger answer */
  const seenLedger = useRef<Set<string> | null>(null);
  /** tour steps run one after another, never dropped, never overlapping */
  const tourQueue = useRef<Promise<void>>(Promise.resolve());

  const held = useMemo(() => orders.filter((x) => x.held_recovering || x.status === "HELD"), [orders]);
  const voiceAvailable = voice.supported || voice.provider === "sarvam";

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
        setError(results.some((r) => r.status === "rejected") ? REACH_ERROR : null);
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

  function changeView(next: LedgerView) {
    if (next === viewRef.current) return;
    viewRef.current = next;
    setView(next);
    void refresh(true);
  }

  function speakSummary() {
    if (!stats) {
      toast("Stats abhi aa rahe hain — ek second.");
      return;
    }
    if (!voice.enabled) {
      toast("Voice is off — switch it on, then play the summary.");
      return;
    }
    voice.stop();
    void voice.speak(spokenSummary(stats.stats), "hi-IN");
  }

  /* ---------------- Grand Tour steps 8 and 9 ---------------- */

  const playGate = useCallback(async () => {
    const res = await runScriptedOrder({
      cap_paise: 800_000,
      lines: ["I'd like a Banarasi silk saree for a wedding", "Yes, go ahead."],
    });
    const order = res.order;
    if (!order) {
      setTourNote("The seller did not reach checkout for the gated order. Open the simulator and run the wedding goal by hand.");
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
      setTourNote("The seller did not reach checkout for the gift order. Open the simulator and run the demo buyer by hand.");
      return;
    }
    if (order.status !== "AWAITING_PAYMENT") {
      setTourNote(`The gift order landed in ${order.status} instead of awaiting payment, so there is no bank to fail. Approve it from the queue to continue.`);
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
          setTourNote(describeError(err, "The tour could not stage this step — the shop did not answer. Check that the app is running."));
        }
      });
    },
    [playGate, playFailure],
  );
  useTourAction(onTour);

  /* ---------------- Render ---------------- */

  const merchantName = stats?.merchant?.name ?? "Aapki dukaan";
  const chain = ledger?.chain ?? null;
  const entries = ledger?.entries ?? [];
  const ledgerEmpty = ledger !== null && entries.length === 0;

  const actions = (
    <>
      <AgentVoiceToggle />
      {voiceAvailable ? (
        <Button variant="secondary" size="sm" onClick={speakSummary}>
          <SpeakerIcon />
          Aaj ka summary
        </Button>
      ) : null}
      <Link href="/dashboard?tour=1" className={buttonClasses({ variant: "primary", size: "sm" })}>
        Grand Tour
      </Link>
    </>
  );

  const headerExtra = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {stats ? (
          <>
            <Badge tone={stats.merchant?.live ? "green" : "gray"} dot>
              {stats.merchant?.live ? `${merchantName} · live` : `${merchantName} · offline`}
            </Badge>
            {stats.stats.pending_approvals > 0 ? (
              <Badge tone="violet" dot>
                {stats.stats.pending_approvals} awaiting your call
              </Badge>
            ) : null}
            {stats.stats.held_orders > 0 ? (
              <Badge tone="amber" dot>
                {stats.stats.held_orders} held
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
      title="Control Tower"
      subtitle="Har paisa, likha hua — aaj ki poori kitaab."
      actions={actions}
      headerExtra={headerExtra}
      voice={voiceAvailable ? voice.enabled : undefined}
    >
      <KpiRow stats={stats?.stats ?? null} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="min-w-0 lg:col-span-2" aria-labelledby="ledger-heading">
          <Card className="fade-up overflow-hidden" style={fadeUp(320)} aria-busy={ledger === null || undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rzp-border px-5 py-4">
              <div className="min-w-0">
                <h2 id="ledger-heading" className="font-display text-lg font-semibold tracking-tight text-rzp-text">
                  The book
                </h2>
                <p className="text-xs text-rzp-muted">Bahi-khata, live — newest entry on top.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {chain ? (
                  <span className={cn("font-mono text-xs tnum", chain.intact ? "text-rzp-muted" : "text-[#B3262C]")} aria-live="polite">
                    {chain.count} {chain.count === 1 ? "entry" : "entries"} · chain{" "}
                    <span className={chain.intact ? "font-semibold text-[#087443]" : "font-semibold"}>{chain.intact ? "✓" : `✗ at #${chain.broken_at ?? "?"}`}</span>
                  </span>
                ) : (
                  <Skeleton className="h-4 w-28" />
                )}
                <div role="group" aria-label="Ledger view" className="inline-flex rounded-lg bg-rzp-mist2 p-0.5">
                  {(["shopkeeper", "tech"] as const).map((key) => {
                    const active = view === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => changeView(key)}
                        className={cn(
                          "h-7 rounded-md px-3 text-sm font-medium transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
                          active ? "bg-white text-rzp-blueDeep shadow-sm" : "text-rzp-muted hover:text-rzp-text",
                        )}
                      >
                        {key === "shopkeeper" ? "Shopkeeper" : "Technical"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div aria-live="polite" aria-label="Ledger feed, newest first">
              {ledger === null ? (
                <div className="ledger-spine ruled-paper pl-[6px]">
                  <div className="px-5 py-6">
                    <p className="text-sm text-rzp-muted">Opening the book…</p>
                    <SkeletonLines lines={4} className="mt-4" />
                  </div>
                </div>
              ) : ledgerEmpty ? (
                <div className="ledger-spine ruled-paper pl-[6px]">
                  <div className="flex flex-col items-center px-6 py-10 text-center">
                    <LedgerStamp className="w-56" title="An open ledger, waiting for its first entry" />
                    <p className="mt-4 text-base font-medium text-rzp-text">Ledger abhi khaali hai — run the demo buyer to write the first entry.</p>
                    <p className="mt-1 max-w-md text-sm text-rzp-muted">Every offer, verdict and payment lands here the moment it happens, stamped and hash-chained.</p>
                    <Link href="/simulator" className={buttonClasses({ variant: "primary", size: "sm", className: "mt-4" })}>
                      Run the demo buyer
                    </Link>
                  </div>
                </div>
              ) : (
                <LedgerBook entries={entries} view={view} maxHeight="62vh" className="rounded-none border-0 bg-transparent" />
              )}
            </div>
          </Card>
        </section>

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
