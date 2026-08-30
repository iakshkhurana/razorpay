"use client";

import confetti from "canvas-confetti";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { LedgerBook, type LedgerView } from "@/components/LedgerBook";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCards } from "@/components/StatCards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const POLL_MS = 2000;
const CONFETTI_COLORS = ["#1E6E52", "#B77913", "#6B5CA5", "#28356A"];
const REACH_ERROR = "Could not reach the shop. Retrying every 2 seconds — check that the app is running.";

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

/** Two Hinglish lines for speechSynthesis; hi-IN voices read "1,849 rupaye" more reliably than the ₹ glyph. */
function spokenSummary(s: StatsResponse["stats"]): string {
  const rupaye = (paise: number) => `${formatINR(paise).replace("₹", "")} rupaye`;
  const guarded = s.actions_guarded === 1 ? "1 action roka gaya" : `${s.actions_guarded} actions rok liye gaye`;
  const ledger = s.ledger_intact ? "ledger bilkul sahi hai" : `ledger mein entry number ${s.ledger_broken_at ?? 0} par gadbad hai`;
  return `Aaj AI ne ${rupaye(s.revenue_paise)} ki bikri ki, ${rupaye(s.upsell_paise)} ka upsell. ${guarded}, ${ledger}.`;
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
/*  The Control Tower                                                  */
/* ------------------------------------------------------------------ */

interface LedgerState {
  entries: LedgerEntryView[];
  chain: LedgerResponse["chain"];
}

function Dashboard() {
  const { toast } = useToast();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [ledger, setLedger] = useState<LedgerState | null>(null);
  const [pending, setPending] = useState<OrderView[]>([]);
  const [held, setHeld] = useState<OrderView[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [view, setView] = useState<LedgerView>("shopkeeper");
  const [error, setError] = useState<string | null>(null);
  const [tourNote, setTourNote] = useState<string | null>(null);
  const [canSpeak, setCanSpeak] = useState(false);

  const viewRef = useRef<LedgerView>("shopkeeper");
  const inFlight = useRef(false);
  /** bumps on every refresh; a response from an older refresh is ignored */
  const refreshSeq = useRef(0);
  /** ids seen on the previous poll; null until the first ledger answer */
  const seenLedger = useRef<Set<string> | null>(null);
  /** tour steps run one after another, never dropped, never overlapping */
  const tourQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

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
        if (o.status === "fulfilled") setHeld(o.value.orders.filter((x) => x.held_recovering || x.status === "HELD"));
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
    try {
      const utterance = new SpeechSynthesisUtterance(spokenSummary(stats.stats));
      utterance.lang = "hi-IN";
      utterance.rate = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      toast("Speech is not available in this browser.", "deny");
    }
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

  return (
    <>
      <SiteHeader
        right={
          <>
            {canSpeak ? (
              <Button variant="outline" size="sm" onClick={speakSummary}>
                <span aria-hidden="true">🔊</span> Aaj ka summary
              </Button>
            ) : null}
            <Link
              href="/dashboard?tour=1"
              className="inline-flex h-8 items-center rounded-lg border border-action bg-action px-3 text-sm font-medium text-paper hover:bg-action/90"
            >
              Grand Tour
            </Link>
          </>
        }
      />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Control Tower</h1>
            <p className="mt-1 text-sm text-ink/70">
              Namaste ji — {merchantName} ka aaj ka hisaab, live. Har paisa yahan likha hua hai.
            </p>
          </div>
          {stats ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={stats.merchant?.live ? "money" : "ink"}>{stats.merchant?.live ? "Dukaan live" : "Dukaan offline"}</Badge>
              <Badge tone="ink">{stats.modes.payments === "mock" ? "Mock rails" : "Razorpay test"}</Badge>
              <Badge tone="ink">{stats.modes.llm === "openai" ? "Seller agent: OpenAI" : "Seller agent: scripted"}</Badge>
            </div>
          ) : null}
        </div>

        <StatCards stats={stats?.stats ?? null} />

        {error ? (
          <p className="mt-4 text-sm text-deny" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2" aria-labelledby="ledger-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 id="ledger-heading" className="font-display text-lg font-semibold tracking-tight">
                  Bahi-Khata
                </h2>
                {chain ? (
                  <span className={cn("font-mono text-xs tnum", chain.intact ? "text-ink/70" : "text-deny")}>
                    {chain.count} {chain.count === 1 ? "entry" : "entries"} · chain {chain.intact ? "✓" : `✗ at #${chain.broken_at ?? "?"}`}
                  </span>
                ) : null}
              </div>
              <div role="group" aria-label="Ledger view" className="inline-flex rounded-lg border border-ink/15 bg-white/50 p-0.5">
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
                        active ? "bg-action text-paper" : "text-ink/70 hover:text-ink",
                      )}
                    >
                      {key === "shopkeeper" ? "Shopkeeper" : "Technical"}
                    </button>
                  );
                })}
              </div>
            </div>

            <div aria-live="polite" aria-label="Ledger feed, newest first">
              <LedgerBook
                entries={entries}
                view={view}
                maxHeight="62vh"
                emptyText={ledger === null ? "Opening the book…" : "Ledger abhi khaali hai — run the demo buyer to write the first entry."}
              />
            </div>
            {ledgerEmpty ? (
              <p className="mt-3 text-sm text-ink/70">
                <Link href="/simulator" className="text-action underline-offset-4 hover:underline">
                  Run the demo buyer
                </Link>{" "}
                and the first line writes itself here.
              </p>
            ) : null}
          </section>

          <aside>
            <ApprovalQueue pending={pending} held={held} loaded={ordersLoaded} onChanged={() => refresh(true)} />
          </aside>
        </div>

        {tourNote ? (
          <p className="mt-6 text-sm text-deny" role="status">
            {tourNote}
          </p>
        ) : null}
      </main>

      <Suspense fallback={null}>
        <PaidNotice />
      </Suspense>
    </>
  );
}

export default function DashboardPage() {
  return <Dashboard />;
}
