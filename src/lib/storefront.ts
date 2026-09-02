import {
  addMandateSpend,
  decrementStock,
  getMandate,
  getMerchant,
  getOffer,
  getOrder,
  getOrderByIdempotencyKey,
  getOrderByPaymentRef,
  getPolicy,
  getSku,
  idempotencyKey,
  insertOffer,
  insertOrder,
  listOrders,
  listSkus,
  listUsedNonces,
  markNonceUsed,
  updateOrder,
} from "./db";
import { newId } from "./ids";
import { appendEntry, chainSummary, listEntries, recordVerdict } from "./ledger";
import { formatINR } from "./money";
import { canTransition, transition, type OrderEvent } from "./orders/stateMachine";
import { CustomerEmailSchema, getPaymentPort, type PaymentEvent, type PaymentHandle } from "./payments";
import { computeTotals, evaluate } from "./policy/engine";
import {
  DEFAULT_POLICY,
  type LedgerEntry,
  type MandateClaims,
  type MoneyAction,
  type Offer,
  type Order,
  type Policy,
  type Sku,
  type Verdict,
} from "./schemas";
import { nowIso, nowSeconds } from "./utils";

/**
 * The storefront is the only code that turns a verdict into an order or a payment.
 * Every function here writes to the ledger before it returns, whatever the verdict.
 */

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

export function activePolicy(): Policy {
  return getPolicy() ?? DEFAULT_POLICY;
}

export function merchantName(): string {
  return getMerchant()?.name ?? "the shop";
}

function pass(rule: string, detail: string) {
  return [{ rule, result: "pass" as const, detail }];
}

/* ------------------------------------------------------------------ */
/*  Offers                                                             */
/* ------------------------------------------------------------------ */

export interface MakeOfferInput {
  mandate: MandateClaims;
  sku_ids: string[];
  qty: number;
  /** declared discount off list, 0 by default */
  discount_pct?: number;
  /** explicit proposed total (a buyer's haggle); overrides the discount calculation */
  proposed_total_paise?: number;
  is_bundle?: boolean;
  type?: "offer" | "discount";
  actor?: "buyer_agent" | "seller_agent";
  now?: number;
}

export interface OfferResult {
  offer: Offer;
  verdict: Verdict;
  action: MoneyAction;
  entry: LedgerEntry;
  skus: Sku[];
}

export function proposedTotal(list_total_paise: number, discount_pct: number): number {
  return Math.round((list_total_paise * (100 - discount_pct)) / 100);
}

/** Prices a basket, asks the engine, writes the verdict, stores the offer. */
export function makeOffer(input: MakeOfferInput): OfferResult {
  const now = input.now ?? nowSeconds();
  const catalog = listSkus();
  const discount_pct = input.discount_pct ?? 0;
  const draft: MoneyAction = {
    type: input.type ?? (discount_pct > 0 ? "discount" : "offer"),
    sku_ids: input.sku_ids,
    qty: input.qty,
    proposed_total_paise: 0,
    discount_pct,
  };
  const totals = computeTotals(draft, catalog);
  const action: MoneyAction = {
    ...draft,
    proposed_total_paise: input.proposed_total_paise ?? proposedTotal(totals.list_total_paise, discount_pct),
  };

  const verdict = evaluate(action, input.mandate, activePolicy(), catalog, listUsedNonces(), now);
  const entry = recordVerdict({
    actor: input.actor ?? "policy_engine",
    mandate_id: input.mandate.mandate_id,
    action: action.type,
    amount_paise: action.proposed_total_paise,
    verdict,
  });

  const offer = insertOffer({
    id: newId("off"),
    mandate_id: input.mandate.mandate_id,
    sku_ids: action.sku_ids,
    qty: action.qty,
    total_paise: action.proposed_total_paise,
    list_total_paise: totals.list_total_paise,
    discount_pct,
    is_bundle: input.is_bundle ?? false,
    verdict,
    created_at: nowIso(),
  });

  return { offer, verdict, action, entry, skus: totals.found };
}

/** For a bundle, everything after the anchor SKU is the upsell. */
export function upsellPaise(offer: Pick<Offer, "sku_ids" | "qty" | "is_bundle">): number {
  if (!offer.is_bundle || offer.sku_ids.length < 2) return 0;
  return offer.sku_ids
    .slice(1)
    .map((id) => getSku(id)?.price_paise ?? 0)
    .reduce((acc, p) => acc + p, 0) * offer.qty;
}

/* ------------------------------------------------------------------ */
/*  Checkout                                                           */
/* ------------------------------------------------------------------ */

export type CheckoutResult =
  | { ok: true; verdict: Verdict; order: Order; entry: LedgerEntry; duplicate: boolean; payment_error?: string }
  | { ok: false; verdict: Verdict; order: null; entry: LedgerEntry };

/**
 * A mandate's `user_ref` is free-form — an email, a phone, a nickname. The payment
 * adapter validates its customer block strictly, so only send an address the same
 * validator accepts; anything else travels as the name alone.
 */
function customerFor(mandate: MandateClaims) {
  const email = CustomerEmailSchema.safeParse(mandate.user_ref);
  return { name: mandate.user_ref, email: email.success ? email.data : undefined };
}

function describeOrder(order: Pick<Order, "sku_ids" | "qty">): string {
  const names = order.sku_ids.map((id) => getSku(id)?.name ?? id);
  const qty = order.qty > 1 ? ` ×${order.qty}` : "";
  return `${merchantName()}: ${names.join(" + ")}${qty}`;
}

function attachPaymentLink(order: Order, handle: PaymentHandle, mandate_id: string, kind: "link" | "fallback"): Order {
  const next = updateOrder(order.id, {
    payment_url: handle.payment_url,
    payment_ref: handle.payment_ref,
    attempts: order.attempts + 1,
  }) as Order;
  appendEntry({
    actor: "payments",
    mandate_id,
    action: kind === "link" ? "payment.link_issued" : "payment.fallback_link_issued",
    amount_paise: order.amount_paise,
    verdict: "INFO",
    reason_code: kind === "link" ? "PAYMENT_LINK_ISSUED" : "FALLBACK_LINK_ISSUED",
    human_reason:
      kind === "link"
        ? `Payment link ready for ${formatINR(order.amount_paise)} via ${handle.provider} — waiting for the bank.`
        : `Backup payment link ready for ${formatINR(order.amount_paise)} (attempt ${next.attempts}).`,
    policy_checks: pass("payment_adapter", `${handle.provider}:${handle.payment_ref}`),
  });
  return next;
}

/**
 * Re-runs the engine on the stored offer as a `checkout` action. Only an ALLOW
 * reaches the payment adapter; a GATE parks the order for the owner; anything
 * else is written down and refused. Idempotent on mandate_id + offer_id.
 */
export async function checkout(input: { mandate: MandateClaims; offer_id: string; now?: number }): Promise<CheckoutResult> {
  const now = input.now ?? nowSeconds();
  const mandate_id = input.mandate.mandate_id;
  const offer = getOffer(input.offer_id);

  if (!offer || offer.mandate_id !== mandate_id) {
    const verdict: Verdict = {
      decision: "DENY",
      reason_code: "SKU_NOT_FOUND",
      human_reason: "That offer does not exist for this mandate. Ask the seller for a fresh offer.",
      policy_checks: [{ rule: "offer_exists", result: "fail", detail: input.offer_id }],
    };
    const entry = recordVerdict({ mandate_id, action: "checkout", amount_paise: 0, verdict });
    return { ok: false, verdict, order: null, entry };
  }

  const existing = getOrderByIdempotencyKey(idempotencyKey(mandate_id, offer.id));
  if (!existing && listOrders({ status: "PENDING_APPROVAL" }).some((o) => o.mandate_id === mandate_id)) {
    const verdict: Verdict = {
      decision: "DENY",
      reason_code: "MANDATE_REPLAY",
      human_reason: "This mandate already has an order waiting for the owner. One mandate, one order at a time.",
      policy_checks: [{ rule: "mandate_replay", result: "fail", detail: "pending approval exists" }],
    };
    const entry = recordVerdict({ mandate_id, action: "checkout", amount_paise: offer.total_paise, verdict });
    return { ok: false, verdict, order: null, entry };
  }
  if (existing) {
    const entry = appendEntry({
      actor: "system",
      mandate_id,
      action: "checkout.duplicate",
      amount_paise: existing.amount_paise,
      verdict: "INFO",
      reason_code: "IDEMPOTENT_REPLAY",
      human_reason: `Checkout for this offer already exists (${existing.status}) — returning the same order.`,
      policy_checks: pass("idempotency", `${mandate_id}:${offer.id}`),
    });
    return { ok: true, verdict: offer.verdict, order: existing, entry, duplicate: true };
  }

  const action: MoneyAction = {
    type: "checkout",
    sku_ids: offer.sku_ids,
    qty: offer.qty,
    proposed_total_paise: offer.total_paise,
    discount_pct: offer.discount_pct,
  };
  const verdict = evaluate(action, input.mandate, activePolicy(), listSkus(), listUsedNonces(), now);
  const entry = recordVerdict({ mandate_id, action: "checkout", amount_paise: offer.total_paise, verdict });

  if (verdict.decision === "DENY" || verdict.decision === "COUNTER") {
    return { ok: false, verdict, order: null, entry };
  }

  const ts = nowIso();
  let order = insertOrder({
    id: newId("ord"),
    mandate_id,
    offer_id: offer.id,
    sku_ids: offer.sku_ids,
    qty: offer.qty,
    amount_paise: offer.total_paise,
    list_total_paise: offer.list_total_paise,
    upsell_paise: upsellPaise(offer),
    status: "DRAFT",
    payment_url: null,
    payment_ref: null,
    attempts: 0,
    created_at: ts,
    updated_at: ts,
  });

  if (verdict.decision === "GATE") {
    order = updateOrder(order.id, { status: transition(order.status, "GATE") }) as Order;
    return { ok: true, verdict, order, entry, duplicate: false };
  }

  const issued = await issueLinkOrRecord(order, input.mandate, "link");
  return {
    ok: true,
    verdict,
    order: issued.order,
    entry,
    duplicate: false,
    ...(issued.error ? { payment_error: issued.error } : {}),
  };
}

async function issuePaymentLink(
  order: Order,
  mandate: MandateClaims,
  kind: "link" | "fallback",
  event: OrderEvent = kind === "link" ? "PAYMENT_LINK_CREATED" : "FALLBACK_LINK_ISSUED",
): Promise<Order> {
  const port = getPaymentPort();
  const base = {
    order_id: order.id,
    amount_paise: order.amount_paise,
    description: describeOrder(order),
    idempotency_key: idempotencyKey(order.mandate_id, order.offer_id),
    customer: customerFor(mandate),
  };
  const handle =
    kind === "link" ? await port.createOrder(base) : await port.issueFallbackLink({ ...base, attempt: order.attempts + 1 });

  const withStatus = updateOrder(order.id, { status: transition(order.status, event) }) as Order;
  markNonceUsed(mandate.nonce, mandate.mandate_id);
  return attachPaymentLink(withStatus, handle, mandate.mandate_id, kind);
}

/**
 * A provider outage is a money-path event, so it is written down like any other:
 * the order stays where it was, nothing is charged, and the caller gets a sentence
 * it can show a human instead of a stack trace.
 */
async function issueLinkOrRecord(
  order: Order,
  mandate: MandateClaims,
  kind: "link" | "fallback",
  event?: OrderEvent,
): Promise<{ order: Order; error?: string }> {
  try {
    return { order: await issuePaymentLink(order, mandate, kind, event) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "the payment provider did not respond";
    appendEntry({
      actor: "payments",
      mandate_id: mandate.mandate_id,
      action: kind === "link" ? "payment.link_failed" : "payment.fallback_failed",
      amount_paise: order.amount_paise,
      verdict: "FAILED",
      reason_code: kind === "link" ? "PAYMENT_LINK_ERROR" : "FALLBACK_LINK_ERROR",
      human_reason: `Could not create a payment link: ${message}. Nothing was charged — the order is saved and can be retried.`,
      policy_checks: [{ rule: "payment_adapter", result: "fail", detail: `${kind} link: ${message}` }],
    });
    return { order: getOrder(order.id) ?? order, error: message };
  }
}

/* ------------------------------------------------------------------ */
/*  Payment events                                                     */
/* ------------------------------------------------------------------ */

export type PaymentEventResult =
  | { ok: true; order: Order; duplicate: boolean }
  | { ok: false; error: string };

function mandateClaimsForOrder(order: Order): MandateClaims | null {
  const rec = getMandate(order.mandate_id);
  if (!rec) return null;
  return {
    mandate_id: rec.id,
    agent_id: rec.agent_id,
    user_ref: rec.user_ref,
    spend_cap_paise: rec.spend_cap_paise,
    category_scope: rec.category_scope,
    exp: rec.exp,
    nonce: rec.nonce,
  };
}

/** Applies a verified webhook event. Failure runs the whole HELD → backup-link path. */
export async function applyPaymentEvent(event: PaymentEvent): Promise<PaymentEventResult> {
  const order =
    (event.order_id ? getOrder(event.order_id) : null) ?? getOrderByPaymentRef(event.payment_ref) ?? null;
  if (!order) return { ok: false, error: `No order for payment ${event.payment_ref}` };

  if (event.type === "captured") {
    if (!canTransition(order.status, "PAYMENT_CAPTURED")) {
      return { ok: true, order, duplicate: true };
    }
    const paid = updateOrder(order.id, { status: transition(order.status, "PAYMENT_CAPTURED") }) as Order;
    addMandateSpend(order.mandate_id, order.amount_paise);
    for (const id of order.sku_ids) decrementStock(id, order.qty);
    appendEntry({
      actor: "payments",
      mandate_id: order.mandate_id,
      action: "payment.captured",
      amount_paise: order.amount_paise,
      verdict: "PAID",
      reason_code: "PAYMENT_CAPTURED",
      human_reason: `${formatINR(order.amount_paise)} received — order paid and stock updated.`,
      policy_checks: pass("payment_capture", event.payment_ref),
    });
    return { ok: true, order: paid, duplicate: false };
  }

  if (!canTransition(order.status, "PAYMENT_FAILED")) {
    return { ok: true, order, duplicate: true };
  }
  let current = updateOrder(order.id, { status: transition(order.status, "PAYMENT_FAILED") }) as Order;
  appendEntry({
    actor: "payments",
    mandate_id: order.mandate_id,
    action: "payment.failed",
    amount_paise: order.amount_paise,
    verdict: "FAILED",
    reason_code: "PAYMENT_FAILED",
    human_reason: `Payment of ${formatINR(order.amount_paise)} failed at the bank.`,
    policy_checks: pass("payment_capture", `${event.payment_ref}: ${event.raw_event}`),
  });

  current = updateOrder(current.id, { status: transition(current.status, "HOLD") }) as Order;
  appendEntry({
    actor: "system",
    mandate_id: order.mandate_id,
    action: "order.held",
    amount_paise: order.amount_paise,
    verdict: "HELD",
    reason_code: "ORDER_HELD",
    human_reason: "Order held — nothing lost. Issuing a backup payment link.",
    policy_checks: pass("failure_recovery", "held for retry"),
  });

  const mandate = mandateClaimsForOrder(current);
  if (!mandate) return { ok: false, error: `Mandate ${current.mandate_id} missing for held order` };

  try {
    current = await issuePaymentLink(current, mandate, "fallback");
  } catch (err) {
    appendEntry({
      actor: "payments",
      mandate_id: order.mandate_id,
      action: "payment.fallback_failed",
      amount_paise: order.amount_paise,
      verdict: "HELD",
      reason_code: "FALLBACK_LINK_ERROR",
      human_reason: `Could not issue a backup link yet: ${err instanceof Error ? err.message : "provider error"}. Order stays held.`,
      policy_checks: [{ rule: "payment_adapter", result: "fail", detail: "issueFallbackLink threw" }],
    });
  }
  return { ok: true, order: current, duplicate: false };
}

/**
 * Confirms an awaiting order from the provider's own record. Used when no
 * webhook can reach this server (local Razorpay test mode without a tunnel):
 * the client polls, we ask Razorpay, and only a provider-reported "paid"
 * becomes PAID. Mock payments report "unknown" and nothing changes.
 */
export async function reconcileOrder(order_id: string): Promise<{ order: Order; changed: boolean } | null> {
  const order = getOrder(order_id);
  if (!order) return null;
  if (order.status !== "AWAITING_PAYMENT" || !order.payment_ref) return { order, changed: false };

  const port = getPaymentPort();
  let status: Awaited<ReturnType<typeof port.fetchStatus>>;
  try {
    status = await port.fetchStatus(order.payment_ref);
  } catch {
    return { order, changed: false };
  }
  if (status !== "paid" && status !== "failed") return { order, changed: false };

  const result = await applyPaymentEvent({
    type: status === "paid" ? "captured" : "failed",
    payment_ref: order.payment_ref,
    order_id: order.id,
    amount_paise: order.amount_paise,
    raw_event: `${port.mode}.reconcile.${status}`,
  });
  if (!result.ok) return { order, changed: false };
  return { order: result.order, changed: !result.duplicate };
}

/* ------------------------------------------------------------------ */
/*  Owner decisions                                                    */
/* ------------------------------------------------------------------ */

export type OwnerDecisionResult =
  | { ok: true; order: Order }
  /** `provider` means the decision stood but the rails failed — retryable, not a conflict. */
  | { ok: false; error: string; kind: "state" | "provider" };

export async function ownerDecision(order_id: string, decision: "approve" | "reject"): Promise<OwnerDecisionResult> {
  const order = getOrder(order_id);
  if (!order) return { ok: false, error: "Order not found.", kind: "state" };
  const event = decision === "approve" ? "OWNER_APPROVED" : "OWNER_REJECTED";
  if (!canTransition(order.status, event)) {
    return { ok: false, error: `Order is ${order.status}; it is not waiting for the owner.`, kind: "state" };
  }

  if (decision === "reject") {
    const rejected = updateOrder(order.id, { status: transition(order.status, "OWNER_REJECTED") }) as Order;
    appendEntry({
      actor: "owner",
      mandate_id: order.mandate_id,
      action: "owner.rejected",
      amount_paise: order.amount_paise,
      verdict: "DENY",
      reason_code: "OWNER_REJECTED",
      human_reason: `The owner declined the ${formatINR(order.amount_paise)} order.`,
      policy_checks: pass("owner_review", "rejected"),
    });
    return { ok: true, order: rejected };
  }

  const mandate = mandateClaimsForOrder(order);
  if (!mandate) return { ok: false, error: "Mandate for this order is missing.", kind: "state" };

  appendEntry({
    actor: "owner",
    mandate_id: order.mandate_id,
    action: "owner.approved",
    amount_paise: order.amount_paise,
    verdict: "ALLOW",
    reason_code: "OWNER_APPROVED",
    human_reason: `The owner approved the ${formatINR(order.amount_paise)} order — issuing the payment link.`,
    policy_checks: pass("owner_review", "approved"),
  });

  const issued = await issueLinkOrRecord(order, mandate, "link", "OWNER_APPROVED");
  if (issued.error) {
    return {
      ok: false,
      error: `Approved, but the payment link could not be created: ${issued.error}. The order stays in your queue — try approving again.`,
      kind: "provider",
    };
  }
  return { ok: true, order: issued.order };
}

/* ------------------------------------------------------------------ */
/*  Bookkeeping entries                                                */
/* ------------------------------------------------------------------ */

export function recordMandateIssued(mandate: MandateClaims): LedgerEntry {
  return appendEntry({
    actor: "system",
    mandate_id: mandate.mandate_id,
    action: "mandate.issued",
    amount_paise: mandate.spend_cap_paise,
    verdict: "INFO",
    reason_code: "MANDATE_ISSUED",
    human_reason: `Mandate issued to ${mandate.agent_id} for ${mandate.user_ref}: up to ${formatINR(mandate.spend_cap_paise)} on ${mandate.category_scope.join(", ")}.`,
    policy_checks: pass("mandate_signature", "HS256"),
  });
}

export function recordShopLive(name: string, skuCount: number): LedgerEntry {
  return appendEntry({
    actor: "owner",
    mandate_id: "",
    action: "shop.live",
    amount_paise: 0,
    verdict: "INFO",
    reason_code: "SHOP_LIVE",
    human_reason: `${name} is live for AI buyers with ${skuCount} products and an approved rulebook.`,
    policy_checks: pass("owner_approval", "policy confirmed"),
  });
}

/* ------------------------------------------------------------------ */
/*  Views & stats                                                      */
/* ------------------------------------------------------------------ */

export interface OrderView extends Order {
  sku_names: string[];
  /** payment failed at least once and a backup link is live */
  held_recovering: boolean;
}

export function orderView(order: Order): OrderView {
  return {
    ...order,
    sku_names: order.sku_ids.map((id) => getSku(id)?.name ?? id),
    held_recovering: order.attempts > 1 && order.status === "AWAITING_PAYMENT",
  };
}

export function approvalQueue(): OrderView[] {
  return listOrders({ status: "PENDING_APPROVAL" }).map(orderView);
}

export function recentOrders(limit = 20): OrderView[] {
  return listOrders().slice(0, limit).map(orderView);
}

export interface Stats {
  revenue_paise: number;
  upsell_paise: number;
  upsell_pct: number;
  orders_paid: number;
  actions_guarded: number;
  ledger_count: number;
  ledger_intact: boolean;
  ledger_broken_at: number | null;
  head_hash: string;
  pending_approvals: number;
  held_orders: number;
}

export function getStats(): Stats {
  const paid = listOrders({ status: "PAID" });
  const revenue = paid.reduce((acc, o) => acc + o.amount_paise, 0);
  const upsell = paid.reduce((acc, o) => acc + o.upsell_paise, 0);
  const entries = listEntries();
  const guarded = entries.filter((e) => e.verdict === "COUNTER" || e.verdict === "GATE" || e.verdict === "DENY").length;
  const chain = chainSummary();
  const held = listOrders({ status: ["HELD", "AWAITING_PAYMENT"] }).filter((o) => o.attempts > 1 || o.status === "HELD");
  return {
    revenue_paise: revenue,
    upsell_paise: upsell,
    upsell_pct: revenue > 0 ? Math.round((upsell / revenue) * 1000) / 10 : 0,
    orders_paid: paid.length,
    actions_guarded: guarded,
    ledger_count: chain.count,
    ledger_intact: chain.intact,
    ledger_broken_at: chain.broken_at,
    head_hash: chain.head_hash,
    pending_approvals: listOrders({ status: "PENDING_APPROVAL" }).length,
    held_orders: held.length,
  };
}
