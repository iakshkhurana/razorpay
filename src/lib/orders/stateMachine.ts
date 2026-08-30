import { z } from "zod";
import { OrderStatusSchema, type LedgerVerdict, type OrderStatus } from "../schemas";

/**
 * Order lifecycle as a pure state machine. No I/O, no clock.
 *
 *   DRAFT ─PAYMENT_LINK_CREATED─▶ AWAITING_PAYMENT ─PAYMENT_CAPTURED─▶ PAID
 *     │                                 │
 *     │                                 └─PAYMENT_FAILED─▶ FAILED ─HOLD─▶ HELD ─FALLBACK_LINK_ISSUED─▶ AWAITING_PAYMENT
 *     │
 *     └─GATE─▶ PENDING_APPROVAL ─OWNER_APPROVED─▶ AWAITING_PAYMENT
 *                                └─OWNER_REJECTED─▶ REJECTED
 *
 * Callers apply `transition` before persisting a status change; the table is the
 * only source of truth, so a status the table does not reach is unreachable.
 * PAID has exactly one way in — a captured payment on a live link — so neither an
 * owner's approval nor a held order can mark money as moved.
 */

export const ORDER_EVENTS = [
  "PAYMENT_LINK_CREATED",
  "PAYMENT_CAPTURED",
  "PAYMENT_FAILED",
  "HOLD",
  "FALLBACK_LINK_ISSUED",
  "OWNER_APPROVED",
  "OWNER_REJECTED",
  "GATE",
] as const;
export const OrderEventSchema = z.enum(ORDER_EVENTS);
export type OrderEvent = z.infer<typeof OrderEventSchema>;

export const ORDER_STATUSES: readonly OrderStatus[] = OrderStatusSchema.options;

export interface OrderTransition {
  readonly from: OrderStatus;
  readonly event: OrderEvent;
  readonly to: OrderStatus;
}

export const TRANSITIONS: readonly OrderTransition[] = Object.freeze(
  (
    [
      { from: "DRAFT", event: "PAYMENT_LINK_CREATED", to: "AWAITING_PAYMENT" },
      { from: "DRAFT", event: "GATE", to: "PENDING_APPROVAL" },
      { from: "AWAITING_PAYMENT", event: "PAYMENT_CAPTURED", to: "PAID" },
      { from: "AWAITING_PAYMENT", event: "PAYMENT_FAILED", to: "FAILED" },
      { from: "FAILED", event: "HOLD", to: "HELD" },
      { from: "HELD", event: "FALLBACK_LINK_ISSUED", to: "AWAITING_PAYMENT" },
      { from: "PENDING_APPROVAL", event: "OWNER_APPROVED", to: "AWAITING_PAYMENT" },
      { from: "PENDING_APPROVAL", event: "OWNER_REJECTED", to: "REJECTED" },
    ] satisfies OrderTransition[]
  ).map((row) => Object.freeze(row)),
);

const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["PAID", "REJECTED"]);

export class InvalidTransitionError extends Error {
  readonly from: OrderStatus;
  readonly event: OrderEvent;

  constructor(from: OrderStatus, event: OrderEvent) {
    super(describeInvalid(from, event));
    this.name = "InvalidTransitionError";
    this.from = from;
    this.event = event;
  }
}

function describeInvalid(from: OrderStatus, event: OrderEvent): string {
  const head = `An order in ${from} cannot take ${event}.`;
  if (isTerminal(from)) return `${head} The order is final.`;
  const allowed = nextEvents(from);
  if (allowed.length === 0) return `${head} ${from} is not a known order status.`;
  return `${head} It only accepts ${allowed.join(" or ")}.`;
}

function findTransition(status: OrderStatus, event: OrderEvent): OrderTransition | undefined {
  return TRANSITIONS.find((t) => t.from === status && t.event === event);
}

/** Next status for `event`, or throws InvalidTransitionError when the table has no row. */
export function transition(status: OrderStatus, event: OrderEvent): OrderStatus {
  const row = findTransition(status, event);
  if (!row) throw new InvalidTransitionError(status, event);
  return row.to;
}

export function canTransition(status: OrderStatus, event: OrderEvent): boolean {
  return findTransition(status, event) !== undefined;
}

export function nextEvents(status: OrderStatus): OrderEvent[] {
  return TRANSITIONS.filter((t) => t.from === status).map((t) => t.event);
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.has(status);
}

const STATUS_COPY: Record<OrderStatus, string> = {
  DRAFT: "Checkout started. No money has moved yet.",
  AWAITING_PAYMENT: "Payment link is live. Waiting for the buyer to pay.",
  PAID: "Payment received. Order complete.",
  FAILED: "Payment failed at the bank. Holding the order while a backup link is prepared.",
  HELD: "Payment failed at the bank. A backup payment link is ready.",
  PENDING_APPROVAL: "Big order — the owner decides. Approve or reject it below.",
  REJECTED: "The owner rejected this order. No money moved.",
};

/**
 * One merchant-facing line per status for the dashboard. Order rows come out of
 * SQLite as plain strings, so an unrecognised status still yields a sentence.
 */
export function describeStatus(status: OrderStatus): string {
  return STATUS_COPY[status] ?? `Order status ${status} is not recognised.`;
}

/** Rubber-stamp label the UI prints beside an order in this status. */
export const STAMP_FOR_STATUS: Readonly<Record<OrderStatus, LedgerVerdict>> = Object.freeze({
  DRAFT: "INFO",
  AWAITING_PAYMENT: "ALLOW",
  PAID: "PAID",
  FAILED: "FAILED",
  HELD: "HELD",
  PENDING_APPROVAL: "GATE",
  REJECTED: "DENY",
});
