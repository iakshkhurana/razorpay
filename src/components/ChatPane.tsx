"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
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

/* ------------------------------------------------------------------ */
/*  Order card                                                         */
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

function OrderStatusLine({ order }: { order: OrderCard }) {
  if (order.status === "PAID") {
    return <p className="text-sm text-money">Paid. The book already has the entry.</p>;
  }
  if (order.status === "REJECTED") {
    return <p className="text-sm text-deny">The owner declined this order. Nothing was charged.</p>;
  }
  if (order.status === "FAILED") {
    return <p className="text-sm text-deny">Payment failed at the bank. The order is being held for a backup payment link.</p>;
  }
  if (order.status === "HELD") {
    return <p className="text-sm text-turmeric">Payment failed at the bank. The order is held while a backup payment link is issued.</p>;
  }
  if (order.status === "PENDING_APPROVAL") {
    return (
      <p className="text-sm text-violet">
        Waiting for the owner&apos;s call. Approve or reject it in the{" "}
        <Link href="/dashboard" className="underline underline-offset-4">
          Control Tower
        </Link>
        .
      </p>
    );
  }
  if (order.held_recovering) {
    return <p className="text-sm text-turmeric">Payment failed at the bank. A backup payment link is ready below.</p>;
  }
  if (order.status === "AWAITING_PAYMENT") {
    return <p className="text-sm text-ink/70">Payment link ready. Pay on the test rails to close the order.</p>;
  }
  return null;
}

function OrderCardView({ order }: { order: OrderCard }) {
  const payable = order.status === "AWAITING_PAYMENT" && Boolean(order.payment_url);
  return (
    <div
      className="ledger-spine ruled-paper w-full max-w-md rounded-xl border border-ink/10 bg-white/60 pl-[6px]"
      role="group"
      aria-label={`Order ${order.id}, ${formatINR(order.amount_paise)}, ${stampForOrder(order)}`}
    >
      <div className="space-y-2.5 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/70">Order</span>
          <span className="truncate font-mono text-xs tnum text-ink/70" title={order.id}>
            {order.id}
          </span>
        </div>
        {order.sku_names.length > 0 ? <p className="text-sm text-ink">{order.sku_names.join(" + ")}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xl font-semibold tnum text-money">{formatINR(order.amount_paise)}</span>
          {/* keyed by status so the stamp presses again whenever the order moves */}
          <VerdictStamp key={`${order.status}-${order.attempts}-${order.held_recovering ? "held" : "ok"}`} kind={stampForOrder(order)} size="sm" />
        </div>
        <OrderStatusLine order={order} />
        {payable && order.payment_url ? (
          <a
            href={order.payment_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-lg border border-action bg-action px-3 text-sm font-medium text-paper transition-colors hover:bg-action/90"
          >
            Pay now
          </a>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stamp row under a seller bubble                                    */
/* ------------------------------------------------------------------ */

function StampRow({ events }: { events: VerdictEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2 border-t border-ink/10 pt-2" aria-label="Policy verdicts">
      {events.map((ev, i) => (
        <li key={`${ev.ledger_entry_id ?? ev.offer_id ?? "ev"}-${i}`} className="text-xs text-ink/70">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <VerdictStamp kind={ev.verdict.decision} size="sm" />
            <span className="font-mono text-sm tnum text-ink">{formatINR(ev.amount_paise)}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/70">{ev.action}</span>
          </div>
          <p className="mt-1 leading-snug">{ev.verdict.human_reason}</p>
          {ev.verdict.counter ? (
            <p className="mt-0.5 leading-snug text-turmeric">
              Counter: <span className="font-mono tnum">{formatINR(ev.verdict.counter.max_total_paise)}</span> — {ev.verdict.counter.suggestion}
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
}

/**
 * Buyer bubbles on the right in an action tint, seller bubbles on the left on
 * paper. The moment a seller turn carries verdict events, each one is stamped
 * inline under that bubble; an order appears as a passbook-style card.
 */
export function ChatPane({ items, busy = false, acceptableOfferId = null, accepting = false, onAcceptOffer, className }: ChatPaneProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  return (
    <section aria-label="Buyer and seller conversation" className={cn("flex min-h-0 flex-col rounded-xl border border-ink/10 bg-white/40", className)}>
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
        <h2 className="font-display text-base font-semibold tracking-tight">Conversation</h2>
        <p className="text-xs text-ink/70">Stamps land the moment policy speaks.</p>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 && !busy ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <p className="font-display text-lg font-semibold tracking-tight">No messages yet.</p>
            <p className="mt-1 max-w-sm text-sm text-ink/70">Run the demo buyer or type a line as the buyer. Every price the seller quotes arrives with a verdict stamp.</p>
          </div>
        ) : null}
        {/* the live region stays mounted so assistive tech announces the first message too */}
        <ol role="log" aria-live="polite" aria-relevant="additions text" className="space-y-3">
            {items.map((item) => {
              if (item.kind === "buyer") {
                return (
                  <li key={item.id} className="flex animate-write-in flex-col items-end">
                    <span className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink/70">Buyer</span>
                    <div className="max-w-[80%] rounded-xl rounded-br-sm bg-action/10 px-4 py-2.5 text-sm text-ink">{item.text}</div>
                  </li>
                );
              }
              if (item.kind === "seller") {
                const acceptable = Boolean(onAcceptOffer && item.offer && acceptableOfferId && item.offer.id === acceptableOfferId);
                return (
                  <li key={item.id} className="flex animate-write-in flex-col items-start">
                    <span className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink/70">Seller</span>
                    <div className="max-w-[88%] rounded-xl rounded-bl-sm border border-ink/10 bg-white/70 px-4 py-2.5 text-sm text-ink">
                      <p className="leading-relaxed">{item.text}</p>
                      <StampRow events={item.events} />
                      {acceptable && item.offer ? (
                        <div className="mt-3">
                          <Button size="sm" onClick={() => onAcceptOffer?.(item.offer as ChatOffer)} loading={accepting} disabled={accepting}>
                            Accept offer
                          </Button>
                          <span className="ml-2 font-mono text-xs tnum text-ink/70">{formatINR(item.offer.total_paise)}</span>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              }
              if (item.kind === "order") {
                return (
                  <li key={item.id} className="flex animate-write-in flex-col items-start pl-0 sm:pl-6">
                    <OrderCardView order={item.order} />
                  </li>
                );
              }
              return (
                <li
                  key={item.id}
                  className={cn(
                    "animate-write-in px-2 py-1 text-center text-xs",
                    item.tone === "deny" && "text-deny",
                    item.tone === "turmeric" && "text-turmeric",
                    item.tone === "money" && "text-money",
                    item.tone === "ink" && "text-ink/70",
                  )}
                >
                  {item.text}
                </li>
              );
            })}
            {busy ? (
              <li className="animate-write-in text-xs text-ink/70" aria-label="Seller is replying">
                Seller is replying…
              </li>
            ) : null}
        </ol>
      </div>
    </section>
  );
}
