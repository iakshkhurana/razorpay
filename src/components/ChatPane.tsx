"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChatVerdict } from "@/components/illustrations";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { VerdictStamp } from "@/components/VerdictStamp";
import type { OrderView } from "@/lib/demo/client";
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

export type ChatItem =
  | { id: string; kind: "buyer"; text: string }
  | { id: string; kind: "seller"; text: string; events: VerdictEvent[]; offer: ChatOffer | null }
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

/** Three-bar equalizer shown while the seller's voice plays. */
function SpeakingBars() {
  return (
    <span role="status" aria-live="polite" className="inline-flex h-5 items-end gap-[3px]" title="Seller is speaking">
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden="true" className="ag-eq-bar block w-[3px] rounded-full bg-rzp-blue" style={{ animationDelay: `${i * 140}ms` }} />
      ))}
      <span className="sr-only">Seller is speaking</span>
    </span>
  );
}

function SellerAvatar({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-blue-50 text-rzp-blueDeep ring-1 ring-rzp-border",
        size === "md" ? "h-10 w-10" : "h-7 w-7",
        className,
      )}
    >
      <StoreGlyph className={size === "md" ? "h-5 w-5" : "h-4 w-4"} />
    </span>
  );
}

function SellerModePill({ mode }: { mode: "openai" | "fallback" | null | undefined }) {
  if (mode === "openai") {
    return (
      <Badge tone="green" dot title="Seller agent runs on OpenAI GPT-4o">
        GPT-4o
      </Badge>
    );
  }
  if (mode === "fallback") {
    return (
      <Badge tone="amber" dot title="Seller agent runs the scripted fallback; no key needed">
        Scripted seller
      </Badge>
    );
  }
  return (
    <Badge tone="gray" dot title="Waiting for the shop to report its mode">
      Seller agent
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Order card: Razorpay checkout pattern                              */
/* ------------------------------------------------------------------ */

function stampForOrder(order: OrderCard): string {
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

function statusPillFor(order: OrderCard): { tone: BadgeTone; label: string } {
  if (order.held_recovering) return { tone: "amber", label: "Backup link ready" };
  switch (order.status) {
    case "PAID":
      return { tone: "green", label: "Paid" };
    case "FAILED":
      return { tone: "red", label: "Payment failed" };
    case "HELD":
      return { tone: "amber", label: "Held" };
    case "PENDING_APPROVAL":
      return { tone: "violet", label: "Owner's call" };
    case "REJECTED":
      return { tone: "red", label: "Rejected" };
    case "AWAITING_PAYMENT":
      return { tone: "blue", label: "Awaiting payment" };
    default:
      return { tone: "gray", label: order.status.replace(/_/g, " ").toLowerCase() };
  }
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function OrderStatusLine({ order }: { order: OrderCard }) {
  if (order.status === "PAID") {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-rzp-green/10 px-3 py-2 text-sm font-medium text-[#087443]">
        <CheckIcon className="h-4 w-4 shrink-0" />
        Paid. The book already has the entry.
      </p>
    );
  }
  if (order.status === "REJECTED") {
    return <p className="rounded-xl bg-rzp-red/10 px-3 py-2 text-sm text-[#B3262C]">The owner declined this order. Nothing was charged.</p>;
  }
  if (order.status === "FAILED") {
    return <p className="rounded-xl bg-rzp-red/10 px-3 py-2 text-sm text-[#B3262C]">Payment failed at the bank. The order is being held for a backup payment link.</p>;
  }
  if (order.status === "HELD") {
    return <p className="rounded-xl bg-rzp-amber/10 px-3 py-2 text-sm text-[#9A4F00]">Payment failed at the bank. The order is held while a backup payment link is issued.</p>;
  }
  if (order.status === "PENDING_APPROVAL") {
    return (
      <p className="rounded-xl bg-rzp-violet/10 px-3 py-2 text-sm text-[#5A3DD8]">
        Waiting for the owner&apos;s call. Approve or reject it in the{" "}
        <Link href="/dashboard" className="font-medium underline underline-offset-4">
          Control Tower
        </Link>
        .
      </p>
    );
  }
  if (order.held_recovering) {
    return <p className="rounded-xl bg-rzp-amber/10 px-3 py-2 text-sm text-[#9A4F00]">Payment failed at the bank. A backup payment link is ready below.</p>;
  }
  if (order.status === "AWAITING_PAYMENT") {
    return <p className="text-sm text-rzp-muted">Payment link ready. Pay on the test rails to close the order.</p>;
  }
  return null;
}

function OrderCardView({ order, sellerName, paymentsMode }: { order: OrderCard; sellerName: string; paymentsMode: "mock" | "razorpay" | null | undefined }) {
  const payable = order.status === "AWAITING_PAYMENT" && Boolean(order.payment_url);
  const amount = formatINR(order.amount_paise);
  const pill = statusPillFor(order);
  const rails = paymentsMode === "razorpay" ? "Razorpay test rails" : paymentsMode === "mock" ? "mock rails" : "test rails";
  return (
    <div
      className="w-full max-w-md overflow-hidden rounded-2xl border border-rzp-border bg-white shadow-card"
      role="group"
      aria-label={`Order ${order.id}, ${amount}, ${stampForOrder(order)}`}
    >
      {/* navy checkout band: merchant + amount */}
      <div className="flex items-center justify-between gap-3 bg-rzp-navy px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15">
            <StoreGlyph className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{sellerName}</p>
            <p className="truncate font-mono text-[10px] tnum text-white/60" title={order.id}>
              Order {order.id}
            </p>
          </div>
        </div>
        <p className="shrink-0 font-mono text-xl font-semibold tnum">{amount}</p>
      </div>

      <div className="space-y-3 px-4 py-3.5">
        {order.sku_names.length > 0 ? <p className="text-sm text-rzp-text">{order.sku_names.join(" + ")}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <Badge tone={pill.tone} dot>
            {pill.label}
          </Badge>
          {/* keyed by status so the stamp presses again whenever the order moves */}
          <VerdictStamp key={`${order.status}-${order.attempts}-${order.held_recovering ? "held" : "ok"}`} kind={stampForOrder(order)} size="sm" />
        </div>
        <OrderStatusLine order={order} />
        {payable && order.payment_url ? (
          <a href={order.payment_url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "payment", size: "lg", className: "w-full" })}>
            {order.held_recovering ? `Pay ${amount} with backup link — Test mode` : `Pay ${amount} — Test mode`}
          </a>
        ) : null}
        <p className="text-[11px] text-rzp-muted">Test mode on {rails}. No real money moves; every hop is written to the ledger.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Receipt lines under a seller bubble                                */
/* ------------------------------------------------------------------ */

function ReceiptLines({ events }: { events: VerdictEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="mt-3 border-t border-dashed border-rzp-text/25 pt-2" aria-label="Policy verdicts">
      {events.map((ev, i) => (
        <li key={`${ev.ledger_entry_id ?? ev.offer_id ?? "ev"}-${i}`} className={cn("py-1.5", i > 0 && "border-t border-dotted border-rzp-border")}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <VerdictStamp kind={ev.verdict.decision} size="sm" />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-rzp-muted">
                {ev.action} · {ev.verdict.reason_code}
              </span>
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold tnum text-rzp-text">{formatINR(ev.amount_paise)}</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-rzp-muted">{ev.verdict.human_reason}</p>
          {ev.verdict.counter ? (
            <p className="mt-0.5 text-xs leading-snug text-[#9A4F00]">
              Counter: <span className="font-mono font-semibold tnum">{formatINR(ev.verdict.counter.max_total_paise)}</span> — {ev.verdict.counter.suggestion}
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
 * Buyer bubbles on the right in blue, seller bubbles on the left on mist.
 * The moment a seller turn carries verdict events, each one lands as a receipt
 * line under that bubble; an order appears as a checkout card.
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
  const listRef = useRef<HTMLDivElement>(null);
  const merchant = sellerName?.trim() || DEFAULT_SELLER;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  return (
    <section
      aria-label="Buyer and seller conversation"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-rzp-border bg-white shadow-card", className)}
    >
      <style>{`
        @keyframes ag-eq { 0%, 100% { height: 5px; } 50% { height: 18px; } }
        .ag-eq-bar { height: 5px; animation: ag-eq 900ms ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ag-eq-bar { animation: none; height: 12px; } }
      `}</style>

      {/* header: seller identity */}
      <header className="flex flex-wrap items-center gap-3 border-b border-rzp-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <SellerAvatar />
          <span className="inline-flex w-4 justify-center">{speaking ? <SpeakingBars /> : null}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-semibold tracking-tight text-rzp-text">
            {merchant} <span className="font-body text-sm font-normal text-rzp-muted">· seller agent</span>
          </h2>
          <p className="text-xs text-rzp-muted">Every price below has already passed the policy engine.</p>
        </div>
        <SellerModePill mode={sellerMode} />
      </header>

      <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-rzp-mist/60 px-4 py-4 sm:px-5">
        {items.length === 0 && !busy ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <ChatVerdict className="w-44" />
            <p className="mt-2 font-display text-lg font-semibold tracking-tight text-rzp-text">No messages yet.</p>
            <p className="mt-1 max-w-sm text-sm text-rzp-muted">Run a demo buyer or type a line as the buyer. Every price the seller quotes arrives with a verdict stamp.</p>
          </div>
        ) : null}
        {/* the live region stays mounted so assistive tech announces the first message too */}
        <ol role="log" aria-live="polite" aria-relevant="additions text" className="space-y-3">
          {items.map((item) => {
            if (item.kind === "buyer") {
              return (
                <li key={item.id} className="flex animate-write-in flex-col items-end">
                  <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rzp-muted">Buyer</span>
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-rzp-blue px-4 py-2.5 text-sm text-white shadow-sm">{item.text}</div>
                </li>
              );
            }
            if (item.kind === "seller") {
              const acceptable = Boolean(onAcceptOffer && item.offer && acceptableOfferId && item.offer.id === acceptableOfferId);
              return (
                <li key={item.id} className="flex animate-write-in items-start gap-2.5">
                  <SellerAvatar size="sm" className="mt-5" />
                  <div className="flex min-w-0 max-w-[88%] flex-col items-start">
                    <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rzp-muted">Seller</span>
                    <div className="rounded-2xl rounded-bl-md border border-rzp-border bg-rzp-mist2 px-4 py-3 text-sm text-rzp-text">
                      <p className="leading-relaxed">{item.text}</p>
                      <ReceiptLines events={item.events} />
                      {acceptable && item.offer ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button size="sm" onClick={() => onAcceptOffer?.(item.offer as ChatOffer)} loading={accepting} disabled={accepting}>
                            Accept offer
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
            <li className="flex animate-write-in items-center gap-2.5" aria-label="Seller is thinking">
              <SellerAvatar size="sm" />
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-rzp-border bg-rzp-mist2 px-3.5 py-2.5 text-xs text-rzp-muted">
                <span className="inline-flex items-center gap-1" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-rzp-blue" style={{ animationDelay: `${i * 200}ms` }} />
                  ))}
                </span>
                Seller is thinking…
              </div>
            </li>
          ) : null}
        </ol>
      </div>
    </section>
  );
}
