"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChatVerdict } from "@/components/illustrations";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { VerdictStamp, stampKindFor, type StampKind } from "@/components/VerdictStamp";
import type { OrderView } from "@/lib/demo/client";
import { useT } from "@/lib/i18n/core";
import { common } from "@/lib/i18n/strings/common";
import { simulator } from "@/lib/i18n/strings/simulator";
import { formatINR } from "@/lib/money";
import type { Decision, Order, VerdictEvent } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Items                                                              */
/* ------------------------------------------------------------------ */

/** The priced proposal under a seller bubble; the Accept button targets it. */
export interface ChatOffer {
  id: string;
  total_paise: number;
  decision: Decision;
  is_bundle: boolean;
}

/** What the order card inside the chat knows. Updated in place as the order moves. */
export interface OrderCard {
  id: string;
  amount_paise: number;
  status: string;
  payment_url: string | null;
  sku_names: string[];
  attempts: number;
  held_recovering: boolean;
}

export type NoteTone = "ink" | "deny" | "turmeric" | "money";

export interface ChatCitation {
  source: string;
  text: string;
}

export type ChatItem =
  | { id: string; kind: "buyer"; text: string }
  | { id: string; kind: "seller"; text: string; events: VerdictEvent[]; offer: ChatOffer | null; citations?: ChatCitation[] }
  | { id: string; kind: "order"; order: OrderCard }
  | { id: string; kind: "note"; text: string; tone: NoteTone };

/** Builds a card from either the bare order in a negotiate reply or the fuller order view. */
export function toOrderCard(order: Order | OrderView): OrderCard {
  const view = "sku_names" in order;
  return {
    id: order.id,
    amount_paise: order.amount_paise,
    status: order.status,
    payment_url: order.payment_url,
    sku_names: view ? order.sku_names : [],
    attempts: order.attempts,
    held_recovering: view ? order.held_recovering : order.attempts > 1 && order.status === "AWAITING_PAYMENT",
  };
}

const DEFAULT_SELLER = "Ramesh Handlooms";

type StampLabelKey = "stamp.ALLOW" | "stamp.COUNTER" | "stamp.GATE" | "stamp.DENY" | "stamp.PAID" | "stamp.FAILED" | "stamp.HELD" | "stamp.INFO";

/** Common-dictionary key for a stamp; unknown kinds read as a plain note. */
function stampLabelKey(kind: StampKind | string): StampLabelKey {
  return `stamp.${stampKindFor(kind)}` as StampLabelKey;
}

/* ------------------------------------------------------------------ */
/*  Seller identity: store glyph, avatar, speaking bars                */
/* ------------------------------------------------------------------ */

/** Small storefront line glyph (awning, door, window) for the seller avatar. */
function StoreGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 9.5 5 4.5h14l1.5 5" />
      <path d="M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.9 2.9 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0" />
      <path d="M5 12.5V20h14v-7.5" />
      <path d="M8.5 20v-5h4v5" />
      <rect x="14" y="14.5" width="2.8" height="2.4" rx="0.6" />
    </svg>
  );
}

/** Four-bar equalizer shown while the seller's voice plays. */
function SpeakingBars({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex h-5 items-end gap-[3px]" title={label}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="ag-eq-bar block w-[3px] rounded-full bg-gradient-to-t from-rzp-blue to-rzp-cyan"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function SellerAvatar({ size = "md", speaking = false, className }: { size?: "sm" | "md"; speaking?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full bg-rzp-ice text-rzp-blueDeep ring-1 ring-rzp-border transition-shadow",
        size === "md" ? "h-10 w-10" : "h-7 w-7",
        speaking && "ring-2 ring-rzp-cyan shadow-[0_0_0_4px_rgba(46,196,230,0.18)]",
        className,
      )}
    >
      <StoreGlyph className={size === "md" ? "h-5 w-5" : "h-4 w-4"} />
    </span>
  );
}

function SellerModePill({ mode }: { mode: "openai" | "fallback" | null | undefined }) {
  const t = useT(simulator);
  if (mode === "openai") {
    return (
      <Badge tone="green" dot title={t("chat.mode.gptTitle")}>
        {t("chat.mode.gpt")}
      </Badge>
    );
  }
  if (mode === "fallback") {
    return (
      <Badge tone="amber" dot title={t("chat.mode.scriptedTitle")}>
        {t("chat.mode.scripted")}
      </Badge>
    );
  }
  return (
    <Badge tone="gray" dot title={t("chat.mode.unknownTitle")}>
      {t("chat.mode.unknown")}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Order card: Razorpay checkout pattern                              */
/* ------------------------------------------------------------------ */

function stampForOrder(order: OrderCard): StampKind {
  if (order.held_recovering) return "HELD";
  switch (order.status) {
    case "PAID":
      return "PAID";
    case "FAILED":
      return "FAILED";
    case "HELD":
      return "HELD";
    case "PENDING_APPROVAL":
      return "GATE";
    case "REJECTED":
      return "DENY";
    default:
      return "ALLOW";
  }
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V9a1.5 1.5 0 0 1 1.5-1.5H11" />
    </svg>
  );
}

function OrderStatusLine({ order }: { order: OrderCard }) {
  const t = useT(simulator);
  if (order.status === "PAID") {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-rzp-green/10 px-3 py-2 text-sm font-medium text-[#087443]">
        <CheckIcon className="h-4 w-4 shrink-0" />
        {t("order.line.paid")}
      </p>
    );
  }
  if (order.status === "REJECTED") {
    return <p className="rounded-xl bg-rzp-red/10 px-3 py-2 text-sm text-[#B3262C]">{t("order.line.rejected")}</p>;
  }
  if (order.status === "FAILED") {
    return <p className="rounded-xl bg-rzp-red/10 px-3 py-2 text-sm text-[#B3262C]">{t("order.line.failed")}</p>;
  }
  if (order.status === "HELD") {
    return <p className="rounded-xl bg-rzp-amber/10 px-3 py-2 text-sm text-[#9A4F00]">{t("order.line.held")}</p>;
  }
  if (order.status === "PENDING_APPROVAL") {
    return (
      <p className="rounded-xl bg-rzp-violet/10 px-3 py-2 text-sm text-[#5A3DD8]">
        {t("order.line.pendingBefore")}{" "}
        <Link href="/dashboard" className="font-medium underline underline-offset-4">
          {t("order.line.pendingLink")}
        </Link>
        {t("order.line.pendingAfter") === "." ? "." : ` ${t("order.line.pendingAfter")}`}
      </p>
    );
  }
  if (order.held_recovering) {
    return <p className="rounded-xl bg-rzp-amber/10 px-3 py-2 text-sm text-[#9A4F00]">{t("order.line.recovering")}</p>;
  }
  if (order.status === "AWAITING_PAYMENT") {
    return <p className="text-sm text-rzp-muted">{t("order.line.awaiting")}</p>;
  }
  return null;
}

function OrderCardView({ order, sellerName, paymentsMode }: { order: OrderCard; sellerName: string; paymentsMode: "mock" | "razorpay" | null | undefined }) {
  const t = useT(simulator);
  const tc = useT(common);
  const reduce = useReducedMotion();
  const payable = order.status === "AWAITING_PAYMENT" && Boolean(order.payment_url);
  const amount = formatINR(order.amount_paise);
  const stamp = stampForOrder(order);
  const stampLabel = tc(stampLabelKey(stamp));
  const rails = paymentsMode === "razorpay" ? t("order.rails.razorpay") : paymentsMode === "mock" ? t("order.rails.mock") : t("order.rails.test");
  const stateKey = `${order.status}-${order.attempts}-${order.held_recovering ? "held" : "ok"}`;

  let pill: { tone: BadgeTone; label: string };
  if (order.held_recovering) pill = { tone: "amber", label: t("order.pill.recovering") };
  else if (order.status === "PAID") pill = { tone: "green", label: tc("status.order.PAID") };
  else if (order.status === "FAILED") pill = { tone: "red", label: t("order.pill.failed") };
  else if (order.status === "HELD") pill = { tone: "amber", label: tc("status.order.HELD") };
  else if (order.status === "PENDING_APPROVAL") pill = { tone: "violet", label: t("order.pill.pending") };
  else if (order.status === "REJECTED") pill = { tone: "red", label: tc("status.order.REJECTED") };
  else if (order.status === "AWAITING_PAYMENT") pill = { tone: "blue", label: tc("status.order.AWAITING_PAYMENT") };
  else pill = { tone: "gray", label: order.status.replace(/_/g, " ").toLowerCase() };

  return (
    <div
      className={cn(
        "w-full max-w-md overflow-hidden rounded-2xl border bg-white shadow-card transition-colors",
        order.status === "PAID" ? "border-rzp-green/40" : "border-rzp-border",
      )}
      role="group"
      aria-label={t("order.aria", { id: order.id, amount, stamp: stampLabel })}
    >
      {/* navy checkout band: merchant + amount */}
      <div className="relative flex items-center justify-between gap-3 overflow-hidden bg-rzp-navy px-4 py-3 text-white">
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-rzp-blue/30 blur-2xl" />
        <div className="relative flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-rzp-cyan ring-1 ring-white/15">
            <StoreGlyph className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{sellerName}</p>
            <p className="truncate font-mono text-[10px] tnum text-white/60" title={order.id}>
              {t("order.id", { id: order.id })}
            </p>
          </div>
        </div>
        <p className="relative shrink-0 font-mono text-xl font-semibold tnum">{amount}</p>
      </div>

      <div className="space-y-3 px-4 py-3.5">
        {order.sku_names.length > 0 ? <p className="text-sm text-rzp-text">{order.sku_names.join(" + ")}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <Badge tone={pill.tone} dot>
            {pill.label}
          </Badge>
          {/* keyed by status so the stamp presses again whenever the order moves */}
          <VerdictStamp key={stateKey} kind={stamp} label={stampLabel} size="sm" />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stateKey}
            initial={{ opacity: 0, y: reduce ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -4 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
          >
            <OrderStatusLine order={order} />
          </motion.div>
        </AnimatePresence>
        {payable && order.payment_url ? (
          <a href={order.payment_url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "payment", size: "lg", className: "w-full" })}>
            {order.held_recovering ? t("order.payBackup", { amount }) : t("order.pay", { amount })}
            <ExternalIcon className="h-4 w-4 opacity-80" />
          </a>
        ) : null}
        <p className="text-[11px] text-rzp-muted">{t("order.footnote", { rails })}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Receipt lines under a seller bubble                                */
/* ------------------------------------------------------------------ */

function ReceiptLines({ events }: { events: VerdictEvent[] }) {
  const t = useT(simulator);
  const tc = useT(common);
  if (events.length === 0) return null;
  return (
    <ul className="mt-3 border-t border-dashed border-rzp-text/25 pt-1" aria-label={t("chat.verdicts")}>
      {events.map((ev, i) => (
        <li key={`${ev.ledger_entry_id ?? ev.offer_id ?? "ev"}-${i}`} className={cn("py-2", i > 0 && "border-t border-dotted border-rzp-border")}>
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
            <VerdictStamp kind={ev.verdict.decision} label={tc(stampLabelKey(ev.verdict.decision))} size="sm" />
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-rzp-muted">
              {ev.action} · {ev.verdict.reason_code}
            </span>
            <span className="font-mono text-sm font-semibold tnum text-rzp-text">{formatINR(ev.amount_paise)}</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-rzp-muted">{ev.verdict.human_reason}</p>
          {ev.verdict.counter ? (
            <p className="mt-0.5 text-xs leading-snug text-[#9A4F00]">
              {t("chat.counter")}: <span className="font-mono font-semibold tnum">{formatINR(ev.verdict.counter.max_total_paise)}</span> — {ev.verdict.counter.suggestion}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Pane                                                               */
/* ------------------------------------------------------------------ */

export interface ChatPaneProps {
  items: ChatItem[];
  /** the seller is composing a reply */
  busy?: boolean;
  /** offer the "Accept offer" button acts on; null hides the button */
  acceptableOfferId?: string | null;
  accepting?: boolean;
  onAcceptOffer?: (offer: ChatOffer) => void;
  className?: string;
  /** merchant shown in the header and on order cards */
  sellerName?: string | null;
  /** which seller is answering: OpenAI or the scripted fallback */
  sellerMode?: "openai" | "fallback" | null;
  /** payment rails named on the order card */
  paymentsMode?: "mock" | "razorpay" | null;
  /** the seller's voice is playing; shows the equalizer beside the avatar */
  speaking?: boolean;
}

const NOTE_TONE: Record<NoteTone, string> = {
  ink: "border-rzp-border bg-white text-rzp-muted",
  deny: "border-rzp-red/30 bg-rzp-red/10 text-[#B3262C]",
  turmeric: "border-rzp-amber/40 bg-rzp-amber/10 text-[#9A4F00]",
  money: "border-rzp-green/30 bg-rzp-green/10 text-[#087443]",
};

/**
 * Buyer bubbles on the right in blue, seller bubbles on the left in white.
 * The moment a seller turn carries verdict events, each one lands as a receipt
 * line under that bubble (stamp · reason · mono amount); an order appears as a
 * checkout card. Every label follows the site language.
 */
export function ChatPane({
  items,
  busy = false,
  acceptableOfferId = null,
  accepting = false,
  onAcceptOffer,
  className,
  sellerName,
  sellerMode = null,
  paymentsMode = null,
  speaking = false,
}: ChatPaneProps) {
  const t = useT(simulator);
  const listRef = useRef<HTMLDivElement>(null);
  const merchant = sellerName?.trim() || DEFAULT_SELLER;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  return (
    <section
      aria-label={t("chat.aria")}
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-rzp-border bg-white shadow-card", className)}
    >
      <style>{`
        @keyframes ag-eq { 0%, 100% { height: 5px; } 50% { height: 18px; } }
        .ag-eq-bar { height: 5px; animation: ag-eq 900ms ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ag-eq-bar { animation: none; height: 12px; } }
      `}</style>

      {/* header: seller identity */}
      <header className="flex flex-wrap items-center gap-3 border-b border-rzp-border bg-white px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <SellerAvatar speaking={speaking} />
          <span className="inline-flex w-5 justify-center">{speaking ? <SpeakingBars label={t("chat.speaking")} /> : null}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-semibold tracking-tight text-rzp-text">
            {merchant} <span className="font-body text-sm font-normal text-rzp-muted">· {t("chat.sellerAgent")}</span>
          </h2>
          <p className="text-xs text-rzp-muted">{t("chat.headerNote")}</p>
        </div>
        <SellerModePill mode={sellerMode} />
      </header>

      <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-rzp-mist/70 px-4 py-4 sm:px-5">
        {items.length === 0 && !busy ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <ChatVerdict className="w-44" />
            <p className="mt-2 font-display text-lg font-semibold tracking-tight text-rzp-text">{t("chat.empty.title")}</p>
            <p className="mt-1 max-w-sm text-sm text-rzp-muted">{t("chat.empty.body")}</p>
          </div>
        ) : null}
        {/* the live region stays mounted so assistive tech announces the first message too */}
        <ol role="log" aria-live="polite" aria-relevant="additions text" className="space-y-3">
          {items.map((item) => {
            if (item.kind === "buyer") {
              return (
                <li key={item.id} className="flex animate-write-in flex-col items-end">
                  <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rzp-muted">{t("chat.buyer")}</span>
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-rzp-blue px-4 py-2.5 text-sm text-white shadow-[0_6px_18px_rgba(47,107,255,0.28)]">{item.text}</div>
                </li>
              );
            }
            if (item.kind === "seller") {
              const acceptable = Boolean(onAcceptOffer && item.offer && acceptableOfferId && item.offer.id === acceptableOfferId);
              return (
                <li key={item.id} className="flex animate-write-in items-start gap-2.5">
                  <SellerAvatar size="sm" className="mt-5" />
                  <div className="flex min-w-0 max-w-[88%] flex-col items-start">
                    <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rzp-muted">{t("chat.seller")}</span>
                    <div className="rounded-2xl rounded-bl-md border border-rzp-border bg-white px-4 py-3 text-sm text-rzp-text shadow-sm">
                      <p className="leading-relaxed">{item.text}</p>
                      {item.citations && item.citations.length > 0 ? (
                        <p className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dotted border-rzp-border pt-2" aria-label={t("chat.source")}>
                          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rzp-muted">{t("chat.source")}</span>
                          {item.citations.map((c) => (
                            <span key={c.source} title={c.text} className="rounded-full border border-rzp-teal/40 bg-rzp-teal/10 px-2 py-0.5 text-[11px] font-medium text-[#0E7C96]">
                              {c.source}
                            </span>
                          ))}
                        </p>
                      ) : null}
                      <ReceiptLines events={item.events} />
                      {acceptable && item.offer ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button size="sm" onClick={() => onAcceptOffer?.(item.offer as ChatOffer)} loading={accepting} disabled={accepting}>
                            {t("chat.accept")}
                          </Button>
                          <span className="font-mono text-xs tnum text-rzp-muted">{formatINR(item.offer.total_paise)}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            }
            if (item.kind === "order") {
              return (
                <li key={item.id} className="flex animate-write-in flex-col items-start pl-0 sm:pl-9">
                  <OrderCardView order={item.order} sellerName={merchant} paymentsMode={paymentsMode} />
                </li>
              );
            }
            return (
              <li key={item.id} className="flex animate-write-in justify-center px-2 py-1">
                <span className={cn("inline-block max-w-[92%] rounded-full border px-3 py-1 text-center text-xs", NOTE_TONE[item.tone])}>{item.text}</span>
              </li>
            );
          })}
          {busy ? (
            <li className="flex animate-write-in items-center gap-2.5" aria-label={t("chat.thinking")}>
              <SellerAvatar size="sm" />
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-rzp-border bg-white px-3.5 py-2.5 text-xs text-rzp-muted shadow-sm">
                <span className="inline-flex items-center gap-1" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-rzp-blue" style={{ animationDelay: `${i * 200}ms` }} />
                  ))}
                </span>
                {t("chat.thinking")}
              </div>
            </li>
          ) : null}
        </ol>
      </div>
    </section>
  );
}
