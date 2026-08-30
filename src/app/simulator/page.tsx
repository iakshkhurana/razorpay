"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { AgentVoiceToggle } from "@/components/AgentVoiceToggle";
import { AppShell } from "@/components/AppShell";
import { ChatPane, toOrderCard, type ChatItem, type ChatOffer, type NoteTone, type OrderCard } from "@/components/ChatPane";
import { FloatingCard, RupeeCoin, ShieldCheck, type IllustrationProps } from "@/components/illustrations";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  api,
  ApiError,
  sleep,
  type CheckoutResponse,
  type DemoGoalView,
  type MandateView,
  type NegotiateResponse,
  type StatsResponse,
} from "@/lib/demo/client";
import { formatINR, rupeesToPaise } from "@/lib/money";
import type { ChatMessage, VerdictEvent } from "@/lib/schemas";
import { isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";
import { useAgentVoice, type AgentVoice } from "@/lib/voice/useAgentVoice";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_SCOPE = ["handloom", "gifts"];
const DEFAULT_CAP_PAISE = 200_000;
const CAP_PRESETS = [200_000, 800_000] as const;
const MAX_BUYER_TURNS = 6;
const TURN_PAUSE_MS = 400;
const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;
const WEBHOOK_DELAY_MS = 1500;

const ACCEPT_LINE = "Yes, that works — I'll take it.";
const OVERSPEND_LINE = "I want the Banarasi silk saree";
const OFFLINE_LINE = "The shop did not respond. Check that the app is running.";

/** Used by the tour when the goals request has not returned. Mirrors the server's gift goal. */
const FALLBACK_GIFT_GOAL: DemoGoalView = {
  key: "gift",
  label: "Anniversary gift for mom · ₹2,000",
  goal: "anniversary gift for mom, budget ₹2000",
  cap_paise: DEFAULT_CAP_PAISE,
  scope: DEFAULT_SCOPE,
};

/** Illustration + one-line story for each demo goal the server offers. */
const GOAL_ART: Record<DemoGoalView["key"], { Art: ComponentType<IllustrationProps>; blurb: string }> = {
  gift: { Art: RupeeCoin, blurb: "Cotton saree plus a matching blouse. ALLOW, then PAID." },
  wedding: { Art: ShieldCheck, blurb: "Juttis out of scope, two Banarasis over the cap. DENY, COUNTER, then the owner's call." },
  failure: { Art: FloatingCard, blurb: "The bank fails the payment. HELD, backup link, then PAID." },
};

interface ActiveMandate {
  token: string;
  view: MandateView;
  /** client clock at issue time; the countdown runs from here */
  issued_at_ms: number;
}

type CapChoice = (typeof CAP_PRESETS)[number] | "custom";

function describeError(err: unknown): string {
  if (err instanceof ApiError && err.status < 500) return err.message;
  return OFFLINE_LINE;
}

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function sameScope(a: string[], b: string[]): boolean {
  const x = [...a].map((s) => s.toLowerCase()).sort();
  const y = [...b].map((s) => s.toLowerCase()).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function secondsLeftOf(m: ActiveMandate, at: number): number {
  return Math.max(0, Math.round((m.issued_at_ms + m.view.expires_in_seconds * 1000 - at) / 1000));
}

/** The newest priced proposal in the conversation; the Accept button targets it. */
function lastOfferIn(items: ChatItem[]): ChatOffer | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.kind === "seller" && it.offer) return it.offer;
  }
  return null;
}

/** Terminal states and a fresher attempt never yield to a slower, older response. */
function supersedes(next: OrderCard, current: OrderCard): boolean {
  if (current.status === "PAID" || current.status === "REJECTED") return next.status === current.status;
  return next.attempts >= current.attempts;
}

/** Owns its own 1s tick so the countdown never re-renders the conversation. */
function ExpiryCountdown({ mandate, onExpire }: { mandate: ActiveMandate; onExpire: () => void }) {
  const [left, setLeft] = useState(() => secondsLeftOf(mandate, Date.now()));
  useEffect(() => {
    const tick = () => {
      const s = secondsLeftOf(mandate, Date.now());
      setLeft(s);
      if (s === 0) {
        window.clearInterval(t);
        onExpire();
      }
    };
    const t = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(t);
  }, [mandate, onExpire]);
  return <dd className={cn("font-mono tnum", left === 0 ? "text-[#B3262C]" : "text-rzp-text")}>{left === 0 ? "expired" : mmss(left)}</dd>;
}

function checkoutReply(res: CheckoutResponse): string {
  if (!res.order) return res.verdict.human_reason;
  const amount = formatINR(res.order.amount_paise);
  const names = res.order.sku_names.length > 0 ? res.order.sku_names.join(" + ") : "your order";
  if (res.duplicate) return `This offer was already checked out — here is the same order for ${amount}.`;
  if (res.order.status === "PENDING_APPROVAL") return `Thank you — ${names} for ${amount} is noted. The shop owner will confirm this one shortly.`;
  return `Done — ${names} for ${amount}. Your payment link is ready; the order is confirmed the moment the bank says yes.`;
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12 20 4l-4 16-4.5-6.5L4 12Z" />
      <path d="M11.5 13.5 20 4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SimulatorPage() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [mandate, setMandate] = useState<ActiveMandate | null>(null);
  const [goals, setGoals] = useState<DemoGoalView[]>([]);
  const [goalsError, setGoalsError] = useState<string | null>(null);
  const [modes, setModes] = useState<StatsResponse["modes"] | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  const [sellerMode, setSellerMode] = useState<"openai" | "fallback" | null>(null);

  const [running, setRunning] = useState(false);
  const [runningGoal, setRunningGoal] = useState<DemoGoalView["key"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const [capChoice, setCapChoice] = useState<CapChoice>(DEFAULT_CAP_PAISE);
  const [customCap, setCustomCap] = useState("3500");
  const [capError, setCapError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pollError, setPollError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  /** Every run, reset or tour action bumps this; stale async work checks it before touching state. */
  const genRef = useRef(0);
  const seqRef = useRef(0);
  const bootedRef = useRef(false);
  const mandateRef = useRef<ActiveMandate | null>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const lastOfferRef = useRef<ChatOffer | null>(null);
  const resolvedOffersRef = useRef<Set<string>>(new Set());
  const [resolvedOffers, setResolvedOffers] = useState<string[]>([]);
  const pollRef = useRef<{ interval: number; timeout: number } | null>(null);
  const celebratedRef = useRef<Set<string>>(new Set());

  /* ---------------------------------------------------------------- */
  /*  Voice: the seller reads its replies aloud                        */
  /* ---------------------------------------------------------------- */

  const voice = useAgentVoice();
  const voiceRef = useRef<AgentVoice>(voice);
  voiceRef.current = voice;
  const [speaking, setSpeaking] = useState(false);
  const speakSeqRef = useRef(0);

  /** Queues a seller line for playback and keeps the equalizer on until the newest line has finished. */
  const sayAsSeller = useCallback((text: string) => {
    const v = voiceRef.current;
    if (!v.enabled) return;
    const seq = ++speakSeqRef.current;
    setSpeaking(true);
    v.speak(text, "en-IN").finally(() => {
      if (seq === speakSeqRef.current) setSpeaking(false);
    });
  }, []);

  /** Cuts any playback: a new turn is starting, or the conversation is being cleared. */
  const hushSeller = useCallback(() => {
    speakSeqRef.current += 1;
    voiceRef.current.stop();
    setSpeaking(false);
  }, []);

  // Leaving the page must not leave the seller talking.
  useEffect(() => () => voiceRef.current.stop(), []);

  /* ---------------------------------------------------------------- */
  /*  Chat helpers                                                     */
  /* ---------------------------------------------------------------- */

  const nextId = useCallback((prefix: string) => {
    seqRef.current += 1;
    return `${prefix}_${seqRef.current}`;
  }, []);

  const addBuyer = useCallback((text: string) => setItems((prev) => [...prev, { id: nextId("b"), kind: "buyer", text }]), [nextId]);
  const addNote = useCallback(
    (text: string, tone: NoteTone = "ink") => setItems((prev) => [...prev, { id: nextId("n"), kind: "note", text, tone }]),
    [nextId],
  );
  const addSeller = useCallback(
    (text: string, events: VerdictEvent[], offer: ChatOffer | null) => {
      if (offer) lastOfferRef.current = offer;
      setItems((prev) => [...prev, { id: nextId("s"), kind: "seller", text, events, offer }]);
      sayAsSeller(text);
    },
    [nextId, sayAsSeller],
  );
  const addOrder = useCallback((order: OrderCard) => setItems((prev) => [...prev, { id: nextId("o"), kind: "order", order }]), [nextId]);
  const updateOrder = useCallback((order: OrderCard) => {
    setItems((prev) =>
      prev.map((it) => (it.kind === "order" && it.order.id === order.id && supersedes(order, it.order) ? { ...it, order } : it)),
    );
  }, []);
  const resolveOffer = useCallback((offer_id: string) => {
    resolvedOffersRef.current.add(offer_id);
    setResolvedOffers((prev) => (prev.includes(offer_id) ? prev : [...prev, offer_id]));
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Order polling + confetti                                         */
  /* ---------------------------------------------------------------- */

  const stopPolling = useCallback(() => {
    if (!pollRef.current) return;
    window.clearInterval(pollRef.current.interval);
    window.clearTimeout(pollRef.current.timeout);
    pollRef.current = null;
  }, []);

  const celebrate = useCallback(async (orderId: string) => {
    if (celebratedRef.current.has(orderId)) return;
    celebratedRef.current.add(orderId);
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const { default: confetti } = await import("canvas-confetti");
      void confetti({
        particleCount: 70,
        spread: 60,
        startVelocity: 28,
        gravity: 0.9,
        ticks: 160,
        origin: { x: 0.35, y: 0.6 },
        colors: ["#12B76A", "#3395FF", "#F59E0B"],
        disableForReducedMotion: true,
      });
    } catch {
      /* confetti is decoration; the PAID stamp already carries the news */
    }
  }, []);

  const startPolling = useCallback(
    (orderId: string) => {
      stopPolling();
      let inFlight = false;
      let failures = 0;
      const tick = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          const { order } = await api.order(orderId);
          failures = 0;
          setPollError(null);
          updateOrder(toOrderCard(order));
          if (order.status === "PAID") {
            stopPolling();
            void celebrate(orderId);
          } else if (order.status === "REJECTED") {
            stopPolling();
          }
        } catch {
          failures += 1;
          if (failures >= 3) setPollError("Could not refresh the order. Check that the app is running.");
        } finally {
          inFlight = false;
        }
      };
      void tick();
      const interval = window.setInterval(() => void tick(), POLL_MS);
      const timeout = window.setTimeout(() => stopPolling(), POLL_TIMEOUT_MS);
      pollRef.current = { interval, timeout };
    },
    [celebrate, stopPolling, updateOrder],
  );

  useEffect(() => stopPolling, [stopPolling]);

  /* ---------------------------------------------------------------- */
  /*  Mandate                                                          */
  /* ---------------------------------------------------------------- */

  const resetChat = useCallback(() => {
    stopPolling();
    hushSeller();
    setItems([]);
    setPollError(null);
    sessionRef.current = undefined;
    lastOfferRef.current = null;
    resolvedOffersRef.current = new Set();
    setResolvedOffers([]);
  }, [hushSeller, stopPolling]);

  /** Mints a mandate and makes it current. Returns null (after a chat line) when the server refuses. */
  const issue = useCallback(
    async (cap_paise: number, scope: string[], gen: number): Promise<ActiveMandate | null> => {
      setIssuing(true);
      try {
        const res = await api.issueMandate({ spend_cap_paise: cap_paise, category_scope: scope });
        if (gen !== genRef.current) return null;
        const active: ActiveMandate = { token: res.token, view: res.mandate, issued_at_ms: Date.now() };
        mandateRef.current = active;
        setMandate(active);
        setExpired(false);
        sessionRef.current = undefined;
        addNote(`Mandate issued — ${formatINR(res.mandate.spend_cap_paise)} on ${res.mandate.scope}. The buyer may shop.`);
        return active;
      } catch (err) {
        if (gen === genRef.current) addNote(describeError(err), "deny");
        return null;
      } finally {
        if (gen === genRef.current) setIssuing(false);
      }
    },
    [addNote],
  );

  const onExpire = useCallback(() => setExpired(true), []);

  async function issueFromSelector() {
    let cap_paise: number;
    if (capChoice === "custom") {
      const rupees = Number(customCap.replace(/[^\d.]/g, ""));
      if (!Number.isFinite(rupees) || rupees <= 0) {
        setCapError("Enter a cap in rupees, like 3500.");
        return;
      }
      cap_paise = rupeesToPaise(rupees);
    } else {
      cap_paise = capChoice;
    }
    setCapError(null);
    const gen = ++genRef.current;
    resetChat();
    await issue(cap_paise, DEFAULT_SCOPE, gen);
  }

  /* ---------------------------------------------------------------- */
  /*  Turns                                                            */
  /* ---------------------------------------------------------------- */

  /** One buyer line through the seller. Appends both bubbles, stamps, and any order. */
  const sellerTurn = useCallback(
    async (token: string, message: string, gen: number): Promise<NegotiateResponse | null> => {
      hushSeller();
      addBuyer(message);
      setBusy(true);
      try {
        const res = await api.negotiate({ mandate_token: token, message, session_id: sessionRef.current });
        if (gen !== genRef.current) return null;
        sessionRef.current = res.session_id;
        setSellerMode(res.mode);
        const offer: ChatOffer | null = res.offer
          ? { id: res.offer.id, total_paise: res.offer.total_paise, decision: res.offer.verdict.decision, is_bundle: res.offer.is_bundle }
          : null;
        addSeller(res.reply, res.events, offer);
        for (const ev of res.events) {
          if (ev.action === "checkout" && ev.offer_id) resolveOffer(ev.offer_id);
        }
        if (res.order) {
          addOrder(toOrderCard(res.order));
          startPolling(res.order.id);
        }
        return res;
      } catch (err) {
        if (gen === genRef.current) addNote(describeError(err), "deny");
        return null;
      } finally {
        if (gen === genRef.current) setBusy(false);
      }
    },
    [addBuyer, addNote, addOrder, addSeller, hushSeller, resolveOffer, startPolling],
  );

  /** Direct checkout of an offer (the Accept button and the tour's safety net). Returns the order id. */
  const checkoutOffer = useCallback(
    async (token: string, offer: ChatOffer, gen: number): Promise<string | null> => {
      hushSeller();
      addBuyer(ACCEPT_LINE);
      setBusy(true);
      try {
        const res = await api.checkout({ mandate_token: token, offer_id: offer.id });
        if (gen !== genRef.current) return null;
        resolveOffer(offer.id);
        const event: VerdictEvent = {
          action: "checkout",
          verdict: res.verdict,
          amount_paise: res.order?.amount_paise ?? offer.total_paise,
          offer_id: offer.id,
          ledger_entry_id: res.ledger_entry_id,
        };
        addSeller(checkoutReply(res), [event], null);
        if (res.order) {
          addOrder(toOrderCard(res.order));
          startPolling(res.order.id);
          return res.order.id;
        }
        return null;
      } catch (err) {
        if (gen === genRef.current) addNote(describeError(err), "deny");
        return null;
      } finally {
        if (gen === genRef.current) setBusy(false);
      }
    },
    [addBuyer, addNote, addOrder, addSeller, hushSeller, resolveOffer, startPolling],
  );

  const simulateBank = useCallback(
    async (orderId: string, outcome: "success" | "failure", gen: number) => {
      try {
        const res = await api.simulateWebhook({ order_id: orderId, outcome });
        if (gen !== genRef.current) return;
        updateOrder(toOrderCard(res.order));
        if (res.order.status === "PAID") {
          stopPolling();
          void celebrate(orderId);
        }
      } catch (err) {
        if (gen === genRef.current) addNote(describeError(err), "deny");
      }
    },
    [addNote, celebrate, stopPolling, updateOrder],
  );

  /* ---------------------------------------------------------------- */
  /*  Demo buyer loop                                                  */
  /* ---------------------------------------------------------------- */

  const runDemo = useCallback(
    async (goal: DemoGoalView, opts: { stopAfterAllow?: boolean; reuseMandate?: boolean } = {}) => {
      const gen = ++genRef.current;
      setRunning(true);
      setRunningGoal(goal.key);
      try {
        let active = mandateRef.current;
        const reusable =
          opts.reuseMandate &&
          active !== null &&
          active.view.spend_cap_paise === goal.cap_paise &&
          sameScope(active.view.category_scope, goal.scope) &&
          secondsLeftOf(active, Date.now()) > 60;
        if (!reusable) {
          resetChat();
          active = await issue(goal.cap_paise, goal.scope, gen);
        }
        if (!active) return;
        const token = active.token;

        const transcript: ChatMessage[] = [];
        let lastEvents: VerdictEvent[] = [];
        let orderPlaced = false;

        for (let turn = 0; turn < MAX_BUYER_TURNS; turn += 1) {
          let next;
          try {
            next = await api.buyerNext({ goal_key: goal.key, transcript, last_events: lastEvents, turn, order_placed: orderPlaced });
          } catch (err) {
            if (gen === genRef.current) addNote(describeError(err), "deny");
            return;
          }
          if (gen !== genRef.current) return;
          if (next.done || !next.message) break;

          if (turn > 0) {
            await sleep(TURN_PAUSE_MS);
            if (gen !== genRef.current) return;
          }

          const res = await sellerTurn(token, next.message, gen);
          if (!res) return;
          transcript.push({ role: "buyer", content: next.message }, { role: "seller", content: res.reply });
          lastEvents = res.events;

          if (res.order) {
            orderPlaced = true;
            if (goal.key === "failure" && res.order.status === "AWAITING_PAYMENT") {
              await sleep(WEBHOOK_DELAY_MS);
              if (gen !== genRef.current) return;
              addNote("Simulating a bank failure on the test rails…", "turmeric");
              await simulateBank(res.order.id, "failure", gen);
            }
            break;
          }
          if (opts.stopAfterAllow && res.events.some((e) => e.action !== "checkout" && e.verdict.decision === "ALLOW")) break;

          await sleep(TURN_PAUSE_MS);
          if (gen !== genRef.current) return;
        }
      } finally {
        if (gen === genRef.current) {
          setRunning(false);
          setRunningGoal(null);
        }
      }
    },
    [addNote, issue, resetChat, sellerTurn, simulateBank],
  );

  /* ---------------------------------------------------------------- */
  /*  Manual turns                                                     */
  /* ---------------------------------------------------------------- */

  async function sendManual() {
    const text = draft.trim();
    if (!text || running) return;
    const active = mandateRef.current;
    if (!active) {
      addNote("Issue a mandate first — the buyer needs one before it can talk to the shop.", "deny");
      return;
    }
    setDraft("");
    const gen = ++genRef.current;
    setRunning(true);
    try {
      await sellerTurn(active.token, text, gen);
    } finally {
      if (gen === genRef.current) setRunning(false);
    }
  }

  async function acceptOffer(offer: ChatOffer) {
    const active = mandateRef.current;
    if (!active || running) return;
    const gen = ++genRef.current;
    setRunning(true);
    setAccepting(true);
    try {
      await checkoutOffer(active.token, offer, gen);
    } finally {
      if (gen === genRef.current) {
        setRunning(false);
        setAccepting(false);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Tour                                                             */
  /* ---------------------------------------------------------------- */

  const tourImpl = useRef<(detail: TourEventDetail) => void>(() => undefined);

  useEffect(() => {
    tourImpl.current = (detail) => {
      if (!isTourActive()) return;
      const giftGoal = goals.find((g) => g.key === "gift") ?? FALLBACK_GIFT_GOAL;

      const tourMandate = async () => {
        const gen = ++genRef.current;
        setRunning(true);
        try {
          resetChat();
          await issue(giftGoal.cap_paise, giftGoal.scope, gen);
        } finally {
          if (gen === genRef.current) setRunning(false);
        }
      };

      const standingAllow = () => {
        const offer = lastOfferRef.current;
        return offer && offer.decision === "ALLOW" && !resolvedOffersRef.current.has(offer.id) ? offer : null;
      };

      const tourPay = async () => {
        // Reached cold (reload mid-tour, or Next before the offer landed) there is nothing to
        // accept and the seller would counter instead; stage the bundle offer first.
        if (!mandateRef.current || !standingAllow()) {
          await runDemo(giftGoal, { stopAfterAllow: true, reuseMandate: true });
          if (!standingAllow()) return;
        }
        const gen = ++genRef.current;
        setRunning(true);
        try {
          const active = mandateRef.current;
          if (!active) return;
          const res = await sellerTurn(active.token, ACCEPT_LINE, gen);
          if (!res) return;
          let orderId = res.order?.id ?? null;
          if (!orderId) {
            // The seller talked but did not close: check out the standing ALLOW offer directly.
            const offer = standingAllow();
            if (offer) orderId = await checkoutOffer(active.token, offer, gen);
          }
          if (!orderId || gen !== genRef.current) return;
          await sleep(WEBHOOK_DELAY_MS);
          if (gen !== genRef.current) return;
          await simulateBank(orderId, "success", gen);
        } finally {
          if (gen === genRef.current) setRunning(false);
        }
      };

      const tourOverspend = async () => {
        const gen = ++genRef.current;
        setRunning(true);
        try {
          resetChat();
          const active = await issue(DEFAULT_CAP_PAISE, DEFAULT_SCOPE, gen);
          if (!active) return;
          await sellerTurn(active.token, OVERSPEND_LINE, gen);
        } finally {
          if (gen === genRef.current) setRunning(false);
        }
      };

      switch (detail.action) {
        case "simulator:mandate":
          void tourMandate();
          break;
        case "simulator:bundle":
          void runDemo(giftGoal, { stopAfterAllow: true, reuseMandate: true });
          break;
        case "simulator:pay":
          void tourPay();
          break;
        case "simulator:overspend":
          void tourOverspend();
          break;
        default:
          break;
      }
    };
  }, [checkoutOffer, goals, issue, resetChat, runDemo, sellerTurn, simulateBank]);

  const onTour = useCallback((detail: TourEventDetail) => tourImpl.current(detail), []);
  useTourAction(onTour);

  /* ---------------------------------------------------------------- */
  /*  Boot                                                             */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    api
      .demoGoals()
      .then((res) => {
        setGoals(res.goals);
        setGoalsError(null);
      })
      .catch(() => setGoalsError("Could not load the demo goals. Check that the app is running."));

    api
      .stats()
      .then((res) => {
        setModes(res.modes);
        setMerchantName(res.merchant?.name ?? null);
      })
      .catch(() => setModes(null));

    if (!isTourActive()) {
      const gen = ++genRef.current;
      void issue(DEFAULT_CAP_PAISE, DEFAULT_SCOPE, gen);
    }
  }, [issue]);

  /* ---------------------------------------------------------------- */
  /*  Derived                                                          */
  /* ---------------------------------------------------------------- */

  const lastOffer = lastOfferIn(items);
  const acceptableOfferId =
    !running && lastOffer && (lastOffer.decision === "ALLOW" || lastOffer.decision === "GATE") && !resolvedOffers.includes(lastOffer.id)
      ? lastOffer.id
      : null;
  const shownSellerMode = sellerMode ?? modes?.llm ?? null;
  /** Top-bar pill: hidden until a voice provider is known (identical on server and first client render). */
  const voicePill = voice.provider === "none" ? undefined : voice.enabled;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <AppShell
      section="simulator"
      title="Buyer simulator"
      subtitle="Talk to the seller as an AI buyer. Every price arrives with a verdict."
      actions={<AgentVoiceToggle />}
      voice={voicePill}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* LEFT: the conversation */}
        <div className="fade-up flex min-h-0 flex-col">
          <ChatPane
            items={items}
            busy={busy}
            acceptableOfferId={acceptableOfferId}
            accepting={accepting}
            onAcceptOffer={(offer) => void acceptOffer(offer)}
            sellerName={merchantName}
            sellerMode={shownSellerMode}
            paymentsMode={modes?.payments ?? null}
            speaking={speaking}
            className="h-[70vh] min-h-[520px]"
          />
          {pollError ? (
            <p className="mt-2 text-sm text-[#B3262C]" role="status">
              {pollError}
            </p>
          ) : null}
        </div>

        {/* RIGHT: the rail */}
        <aside className="fade-up space-y-4" style={{ "--delay": "120ms" } as CSSProperties} aria-label="Mandate and controls">
          {/* 1. Mandate passbook */}
          <Card surface="ledger">
            <CardContent className="space-y-4 pt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-semibold tracking-tight text-rzp-text">Mandate</h2>
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-rzp-muted">Passbook</span>
              </div>

              {mandate ? (
                <dl className="space-y-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-rzp-muted">Agent</dt>
                    <dd className="font-mono text-xs tnum text-rzp-text">{mandate.view.agent_id}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-rzp-muted">For</dt>
                    <dd className="truncate font-mono text-xs tnum text-rzp-text" title={mandate.view.user_ref}>
                      {mandate.view.user_ref}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-rzp-border pt-2">
                    <dt className="font-medium text-rzp-text">Cap</dt>
                    <dd className="font-mono text-2xl font-semibold tnum text-[#087443]">{formatINR(mandate.view.spend_cap_paise)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-rzp-muted">Scope</dt>
                    <dd className="text-right text-rzp-text">{mandate.view.scope}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-rzp-muted">Expires in</dt>
                    <ExpiryCountdown mandate={mandate} onExpire={onExpire} />
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-rzp-muted">Mandate id</dt>
                    <dd className="truncate font-mono text-[11px] tnum text-rzp-muted" title={mandate.view.id}>
                      {mandate.view.id}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div aria-busy={issuing || undefined}>
                  {issuing ? (
                    <div className="space-y-2">
                      <Skeleton className="h-3.5 w-full" />
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="h-8 w-1/2" />
                    </div>
                  ) : (
                    <p className="text-sm text-rzp-muted">No mandate yet. Issue one to let the buyer in.</p>
                  )}
                </div>
              )}
              {expired ? <p className="text-xs text-[#B3262C]">This mandate has expired. Issue a fresh one before the buyer talks again.</p> : null}

              <div className="space-y-2.5 border-t border-rzp-border pt-3">
                <p className="text-xs font-medium text-rzp-muted" id="cap-label">
                  Spend cap for the next mandate
                </p>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-rzp-mist2 p-1" role="group" aria-labelledby="cap-label">
                  {CAP_PRESETS.map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      aria-pressed={capChoice === cap}
                      onClick={() => setCapChoice(cap)}
                      className={cn(
                        "h-8 rounded-lg font-mono text-xs tnum transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
                        capChoice === cap ? "bg-white font-semibold text-rzp-blueDeep shadow-sm" : "text-rzp-muted hover:text-rzp-text",
                      )}
                    >
                      {formatINR(cap)}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={capChoice === "custom"}
                    onClick={() => setCapChoice("custom")}
                    className={cn(
                      "h-8 rounded-lg text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
                      capChoice === "custom" ? "bg-white font-semibold text-rzp-blueDeep shadow-sm" : "text-rzp-muted hover:text-rzp-text",
                    )}
                  >
                    Custom
                  </button>
                </div>
                {capChoice === "custom" ? (
                  <div>
                    <Label htmlFor="custom-cap" className="text-xs">
                      Cap in rupees
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-rzp-muted" aria-hidden="true">
                        ₹
                      </span>
                      <Input
                        id="custom-cap"
                        inputMode="numeric"
                        value={customCap}
                        onChange={(e) => setCustomCap(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void issueFromSelector();
                        }}
                        className="font-mono tnum"
                        aria-invalid={capError ? true : undefined}
                        aria-describedby={capError ? "custom-cap-error" : undefined}
                      />
                    </div>
                  </div>
                ) : null}
                {capError ? (
                  <FieldHint error id="custom-cap-error">
                    {capError}
                  </FieldHint>
                ) : null}
                <Button className="w-full" onClick={() => void issueFromSelector()} loading={issuing} disabled={running || issuing}>
                  Issue new mandate
                </Button>
                <p className="text-[11px] text-rzp-muted">Scope stays handloom, gifts. A new mandate clears the conversation.</p>
              </div>
            </CardContent>
          </Card>

          {/* 2. Demo buyer goals */}
          <Card>
            <CardContent className="space-y-3 pt-5">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight text-rzp-text">Run a demo buyer</h2>
                <p className="mt-0.5 text-xs text-rzp-muted">Pick a goal. The buyer only talks; the engine decides.</p>
              </div>
              {goalsError ? <p className="text-sm text-[#B3262C]">{goalsError}</p> : null}
              {goals.length === 0 && !goalsError ? (
                <div className="space-y-2" aria-busy="true" aria-label="Loading demo goals">
                  <Skeleton className="h-[74px] w-full rounded-xl" />
                  <Skeleton className="h-[74px] w-full rounded-xl" />
                  <Skeleton className="h-[74px] w-full rounded-xl" />
                </div>
              ) : null}
              <div className="space-y-2" role="group" aria-label="Demo goals">
                {goals.map((goal) => {
                  const active = runningGoal === goal.key;
                  const art = GOAL_ART[goal.key];
                  const Art = art?.Art ?? RupeeCoin;
                  return (
                    <button
                      key={goal.key}
                      type="button"
                      onClick={() => void runDemo(goal)}
                      disabled={running}
                      aria-busy={active || undefined}
                      title={goal.goal}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        !running && "card-lift hover:border-[#C9D6EC]",
                        active ? "border-rzp-blue ring-1 ring-rzp-blue/40" : "border-rzp-border",
                      )}
                    >
                      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-rzp-mist2">
                        <Art className="w-12" animate={false} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-rzp-text">{goal.label}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-rzp-muted">{art?.blurb ?? goal.goal}</span>
                      </span>
                      {active ? (
                        <Spinner className="h-4 w-4 shrink-0 text-rzp-blue" />
                      ) : (
                        <ArrowIcon className="h-4 w-4 shrink-0 text-rzp-muted" />
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 3. Talk as the buyer */}
          <Card>
            <CardContent className="space-y-2 pt-5">
              <h2 className="font-display text-lg font-semibold tracking-tight text-rzp-text">
                <label htmlFor="buyer-line">Talk as the buyer</label>
              </h2>
              <div className="flex gap-2">
                <Input
                  id="buyer-line"
                  value={draft}
                  placeholder="Ask for a saree under ₹2,000…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void sendManual();
                    }
                  }}
                  disabled={running}
                  autoComplete="off"
                />
                <Button onClick={() => void sendManual()} disabled={running || draft.trim().length === 0} className="shrink-0">
                  <SendIcon className="h-4 w-4" />
                  Send
                </Button>
              </div>
              <p className="text-[11px] text-rzp-muted">Enter sends. The line goes to the seller under the current mandate.</p>
            </CardContent>
          </Card>

          {/* 4. Modes */}
          <p className="px-1 text-xs text-rzp-muted">
            Seller <span className="font-mono text-rzp-text">{shownSellerMode ?? "—"}</span> · payments{" "}
            <span className="font-mono text-rzp-text">{modes?.payments ?? "—"}</span> · voice{" "}
            <span className="font-mono text-rzp-text">{voice.provider === "none" ? "—" : voice.enabled ? voice.provider : "off"}</span>
            {shownSellerMode === "fallback" ? <span> · scripted seller, no key needed</span> : null}
          </p>
        </aside>
      </div>
    </AppShell>
  );
}
