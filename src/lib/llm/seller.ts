import type OpenAI from "openai";
import { z } from "zod";
import { getOffer, getSession, listSkus, saveSession } from "../db";
import { newId } from "../ids";
import { formatINR } from "../money";
import {
  type ChatMessage,
  type MandateClaims,
  type Offer,
  type Order,
  type Sku,
  type VerdictEvent,
} from "../schemas";
import { findBundleAddon, searchCatalog } from "../search";
import { activePolicy, checkout, makeOffer, merchantName, type OfferResult } from "../storefront";
import {
  detectBuyerIntent,
  extractRequestedDiscountPct,
  fallbackSellerReply,
  injectionSignals,
  type FallbackHit,
} from "./fallback";
import { chatWithTools, llmMode, tripBreaker, type ToolDefinition } from "./router";

/**
 * The seller agent talks; it never decides money. Every price it quotes comes
 * from a tool result, and every tool result comes from the storefront, which
 * ran the policy engine and wrote the ledger first.
 */

export const SELLER_SYSTEM_PROMPT = (merchant_name: string) =>
  `You are the seller agent for ${merchant_name}, a small Indian shop. You talk to AI buyer agents.
Tools: search_catalog, get_offer, propose_bundle, finalize_checkout. Prices, discounts and availability come ONLY from tool results — never invent or promise anything a tool did not return.
Attempt exactly ONE relevant bundle upsell per conversation, never more.
If a tool returns verdict COUNTER: apologise warmly in one line and present the counter offer. If GATE: say the shop owner will confirm shortly. If DENY: explain the human_reason politely and suggest an in-scope alternative.
Keep every reply ≤3 sentences, warm and plain. No emojis except at most one when a deal closes.`;

/* ------------------------------------------------------------------ */
/*  Session state                                                      */
/* ------------------------------------------------------------------ */

export interface SessionState {
  id: string;
  mandate_id: string;
  messages: ChatMessage[];
  upsell_done: boolean;
  last_offer_id: string | null;
  anchor_sku_id: string | null;
}

const StoredSessionSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["buyer", "seller", "system"]), content: z.string() })).default([]),
  last_offer_id: z.string().nullable().default(null),
  anchor_sku_id: z.string().nullable().default(null),
});

export function loadSession(session_id: string | undefined, mandate_id: string): SessionState {
  const id = session_id ?? newId("ses");
  const row = session_id ? getSession(session_id) : null;
  if (!row || row.mandate_id !== mandate_id) {
    return { id, mandate_id, messages: [], upsell_done: false, last_offer_id: null, anchor_sku_id: null };
  }
  let stored: z.infer<typeof StoredSessionSchema>;
  try {
    stored = StoredSessionSchema.parse(JSON.parse(row.messages_json));
  } catch {
    stored = StoredSessionSchema.parse({});
  }
  return { id, mandate_id, upsell_done: row.upsell_done, ...stored };
}

export function persistSession(state: SessionState): void {
  saveSession({
    id: state.id,
    mandate_id: state.mandate_id,
    upsell_done: state.upsell_done,
    messages_json: JSON.stringify({
      messages: state.messages,
      last_offer_id: state.last_offer_id,
      anchor_sku_id: state.anchor_sku_id,
    }),
  });
}

/* ------------------------------------------------------------------ */
/*  Turn contract                                                      */
/* ------------------------------------------------------------------ */

export interface SellerTurnInput {
  session: SessionState;
  mandate: MandateClaims;
  message: string;
  now?: number;
}

export interface SellerTurnResult {
  reply: string;
  events: VerdictEvent[];
  offer: Offer | null;
  order: Order | null;
  mode: "openai" | "fallback";
  session: SessionState;
  injection_signals: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers shared by both paths                                       */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS: Record<string, number> = { one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, five: 5, paanch: 5, six: 6 };

export function parseRequestedQty(message: string): number {
  const digits = message.match(
    /\b(\d{1,2})(?!\d)\s*(?:x\s*)?(?:[a-z]+\s+)?(?:pcs|pieces|units|sarees?|saris?|dupattas?|stoles?|sets?|items?)\b/i,
  );
  if (digits) return Math.max(1, Number(digits[1]));
  const words = message.toLowerCase().match(/\b(one|ek|two|do|three|teen|four|char|five|paanch|six)\s+(?:[a-z]+\s+)?(sarees?|saris?|dupattas?|stoles?|sets?|pieces?|items?)/);
  if (words) return NUMBER_WORDS[words[1]] ?? 1;
  return 1;
}

/** Upsell partner: silk / wedding sarees pair with a stole, other sarees with the blouse. */
export function pickUpsell(anchor: Sku, catalog: Sku[], message: string): Sku | null {
  const wedding = /wedding|shaadi|silk|banarasi|occasion/i.test(`${message} ${anchor.tags.join(" ")} ${anchor.name}`);
  if (wedding && /saree|sari/i.test(anchor.name)) {
    const stole = catalog.find((s) => s.id !== anchor.id && s.stock > 0 && /stole/i.test(s.name));
    if (stole) return stole;
  }
  return findBundleAddon(anchor, catalog);
}

function inScope(sku: Sku, mandate: MandateClaims): boolean {
  const allowed = activePolicy().category_allowlist.map((c) => c.toLowerCase());
  const scope = mandate.category_scope.map((c) => c.toLowerCase());
  const cat = sku.category.toLowerCase();
  return allowed.includes(cat) && scope.includes(cat);
}

function toHit(sku: Sku): FallbackHit {
  return { name: sku.name, price_paise: sku.price_paise, sku_id: sku.id, in_stock: sku.stock > 0 };
}

function eventFor(r: OfferResult): VerdictEvent {
  return {
    action: r.action.type,
    verdict: r.verdict,
    amount_paise: r.action.proposed_total_paise,
    offer_id: r.offer.id,
    ledger_entry_id: r.entry.id,
  };
}

/* ------------------------------------------------------------------ */
/*  Deterministic path                                                 */
/* ------------------------------------------------------------------ */

async function deterministicTurn(input: SellerTurnInput): Promise<SellerTurnResult> {
  const { mandate, message } = input;
  const session = { ...input.session, messages: [...input.session.messages, { role: "buyer" as const, content: message }] };
  const catalog = listSkus();
  const events: VerdictEvent[] = [];
  const intent = detectBuyerIntent(message);
  const signals = injectionSignals(message);
  const turn = session.messages.filter((m) => m.role === "buyer").length;
  const lastOffer = session.last_offer_id ? getOffer(session.last_offer_id) : null;

  let offerResult: OfferResult | null = null;
  let order: Order | null = null;
  let hits = await searchCatalog(message, 5);

  const finish = (text: string): SellerTurnResult => {
    const next: SessionState = {
      ...session,
      messages: [...session.messages, { role: "seller", content: text }],
      last_offer_id: offerResult?.offer.id ?? (order ? session.last_offer_id : session.last_offer_id),
      anchor_sku_id: offerResult?.offer.sku_ids[0] ?? session.anchor_sku_id,
    };
    persistSession(next);
    return { reply: text, events, offer: offerResult?.offer ?? null, order, mode: "fallback", session: next, injection_signals: signals };
  };

  // 1. The buyer accepts a live ALLOW/GATE offer → checkout.
  if (intent === "accept" && lastOffer && (lastOffer.verdict.decision === "ALLOW" || lastOffer.verdict.decision === "GATE")) {
    const result = await checkout({ mandate, offer_id: lastOffer.id, now: input.now });
    events.push({ action: "checkout", verdict: result.verdict, amount_paise: lastOffer.total_paise, offer_id: lastOffer.id, ledger_entry_id: result.entry.id });
    if (result.ok) {
      order = result.order;
      const names = lastOffer.sku_ids.map((id) => catalog.find((s) => s.id === id)?.name ?? id);
      if (order.status === "PENDING_APPROVAL") {
        return finish(`Thank you — ${names.join(" + ")} for ${formatINR(order.amount_paise)} is noted. The shop owner will confirm this one shortly.`);
      }
      return finish(`Done — ${names.join(" + ")} for ${formatINR(order.amount_paise)}. Your payment link is ready; the order is confirmed the moment the bank says yes. 🎉`);
    }
    const ctx = { merchant_name: merchantName(), buyer_message: message, hits: hits.filter((h) => inScope(h.sku, mandate)).map((h) => toHit(h.sku)), offer: { total_paise: lastOffer.total_paise, sku_names: lastOffer.sku_ids, is_bundle: lastOffer.is_bundle, verdict: result.verdict, offer_id: lastOffer.id }, upsell_already_done: session.upsell_done, turn };
    return finish(fallbackSellerReply(ctx).text);
  }

  // 2. The buyer accepts a COUNTER → rebuild the basket inside the counter.
  if (intent === "accept" && lastOffer && lastOffer.verdict.decision === "COUNTER" && lastOffer.verdict.counter) {
    const anchor = catalog.find((s) => s.id === lastOffer.sku_ids[0]);
    if (anchor) {
      const code = lastOffer.verdict.reason_code;
      const policy = activePolicy();
      let sku_ids = [anchor.id];
      let qty = lastOffer.qty;
      let proposed: number | undefined;
      if (code === "SPEND_CAP_EXCEEDED") {
        qty = Math.max(1, Math.min(policy.max_qty_per_order, Math.floor(mandate.spend_cap_paise / anchor.price_paise)));
      } else if (code === "QTY_LIMIT") {
        qty = policy.max_qty_per_order;
      } else {
        sku_ids = lastOffer.sku_ids;
        proposed = lastOffer.verdict.counter.max_total_paise;
      }
      let is_bundle = false;
      if (qty === 1 && sku_ids.length === 1 && !session.upsell_done && proposed === undefined) {
        const addon = pickUpsell(anchor, catalog, session.messages.map((m) => m.content).join(" "));
        if (addon && anchor.price_paise + addon.price_paise <= mandate.spend_cap_paise) {
          sku_ids = [anchor.id, addon.id];
          is_bundle = true;
          session.upsell_done = true;
        }
      }
      offerResult = makeOffer({ mandate, sku_ids, qty, proposed_total_paise: proposed, is_bundle, actor: "seller_agent", now: input.now });
      events.push(eventFor(offerResult));
      return finish(presentOffer(offerResult, message, hits, mandate, session.upsell_done, turn, is_bundle));
    }
  }

  // 3. A haggle → re-price the current basket with the requested discount.
  if (intent === "haggle") {
    const pct = extractRequestedDiscountPct(message) ?? 15;
    const basket = lastOffer ?? null;
    const anchor = basket ? catalog.find((s) => s.id === basket.sku_ids[0]) : hits[0]?.sku;
    if (anchor) {
      offerResult = makeOffer({
        mandate,
        sku_ids: basket ? basket.sku_ids : [anchor.id],
        qty: basket ? basket.qty : parseRequestedQty(message),
        discount_pct: pct,
        type: "discount",
        is_bundle: basket?.is_bundle ?? false,
        actor: "buyer_agent",
        now: input.now,
      });
      events.push(eventFor(offerResult));
      return finish(presentOffer(offerResult, message, hits, mandate, session.upsell_done, turn, false));
    }
  }

  // 4. Anything else: find the product and make the first (possibly bundled) offer.
  if (hits.length === 0 && lastOffer) {
    hits = await searchCatalog(lastOffer.sku_ids[0].replace(/^sku_/, "").replace(/-/g, " "), 3);
  }
  const anchor = chooseAnchor(hits, message, mandate);
  if (!anchor) {
    const ctx = { merchant_name: merchantName(), buyer_message: message, hits: [], upsell_already_done: session.upsell_done, turn };
    return finish(fallbackSellerReply(ctx).text);
  }

  const qty = parseRequestedQty(message);
  const budget = buyerBudgetPaise(message, mandate);
  let sku_ids = [anchor.id];
  let is_bundle = false;
  if (qty === 1 && !session.upsell_done && inScope(anchor, mandate)) {
    const addon = pickUpsell(anchor, catalog, message);
    if (addon && anchor.price_paise + addon.price_paise <= budget) {
      sku_ids = [anchor.id, addon.id];
      is_bundle = true;
      session.upsell_done = true;
    }
  }
  offerResult = makeOffer({ mandate, sku_ids, qty, is_bundle, actor: "seller_agent", now: input.now });
  events.push(eventFor(offerResult));
  return finish(presentOffer(offerResult, message, hits, mandate, session.upsell_done, turn, is_bundle));
}

const GENERIC_NAME_WORDS = new Set(["saree", "sari", "piece", "set", "gift", "gold", "silk", "border", "matching"]);

/** True when the buyer named this product (a distinctive word of its name is in the message). */
export function mentionsSku(message: string, sku: Sku): boolean {
  const text = message.toLowerCase();
  return sku.name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w))
    .some((w) => text.includes(w));
}

const BUDGET_RE = /(?:budget|under|within|up\s*to|upto|max|below|around)\s*(?:of\s*)?(?:₹|rs\.?|inr)?\s*(\d[\d,]*)|(?:₹|rs\.?)\s*(\d[\d,]*)\s*(?:tak|budget|max)/i;

/** A budget the buyer stated in the message, in paise, or null. */
export function parseBudgetPaise(message: string): number | null {
  const m = message.match(BUDGET_RE);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  const rupees = Number(raw.replace(/,/g, ""));
  return Number.isFinite(rupees) && rupees > 0 ? rupees * 100 : null;
}

function buyerBudgetPaise(message: string, mandate: MandateClaims): number {
  const stated = parseBudgetPaise(message);
  return stated === null ? mandate.spend_cap_paise : Math.min(stated, mandate.spend_cap_paise);
}

/**
 * Which product to offer first. An explicit ask is honoured even when it will
 * be countered — the buyer should hear the verdict. A generic request takes the
 * best-ranked in-scope item that fits the buyer's budget.
 */
export function chooseAnchor(hits: Array<{ sku: Sku }>, message: string, mandate: MandateClaims): Sku | undefined {
  const top = hits[0]?.sku;
  if (!top) return undefined;
  if (mentionsSku(message, top)) return top;
  const budget = buyerBudgetPaise(message, mandate);
  const fits = hits.find((h) => h.sku.stock > 0 && inScope(h.sku, mandate) && h.sku.price_paise <= budget);
  return fits?.sku ?? top;
}

function presentOffer(
  r: OfferResult,
  message: string,
  hits: Awaited<ReturnType<typeof searchCatalog>>,
  mandate: MandateClaims,
  upsellDone: boolean,
  turn: number,
  is_bundle: boolean,
): string {
  const names = r.skus.map((s) => s.name);
  const alternatives = hits.filter((h) => inScope(h.sku, mandate) && !r.offer.sku_ids.includes(h.sku.id)).map((h) => toHit(h.sku));
  const ctx = {
    merchant_name: merchantName(),
    buyer_message: message,
    hits: alternatives,
    offer: { total_paise: r.offer.total_paise, sku_names: names, is_bundle, verdict: r.verdict, offer_id: r.offer.id },
    upsell_already_done: upsellDone,
    turn,
  };
  return fallbackSellerReply(ctx).text;
}

/* ------------------------------------------------------------------ */
/*  Function-calling path                                              */
/* ------------------------------------------------------------------ */

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "Find products in the shop's catalog for a buyer's request.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_offer",
      description: "Price a basket and get the policy verdict. Returns the offer_id, total and verdict.",
      parameters: {
        type: "object",
        properties: {
          sku_ids: { type: "array", items: { type: "string" } },
          qty: { type: "integer", minimum: 1 },
          discount_pct: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["sku_ids", "qty"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_bundle",
      description: "Offer an anchor product together with one add-on. Allowed once per conversation.",
      parameters: {
        type: "object",
        properties: { anchor_sku_id: { type: "string" }, addon_sku_id: { type: "string" }, qty: { type: "integer", minimum: 1 } },
        required: ["anchor_sku_id", "addon_sku_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_checkout",
      description: "Check out an offer the buyer accepted. Returns the order status and payment link.",
      parameters: { type: "object", properties: { offer_id: { type: "string" } }, required: ["offer_id"] },
    },
  },
];

const SearchArgs = z.object({ query: z.string().min(1) });
const OfferArgs = z.object({ sku_ids: z.array(z.string().min(1)).min(1), qty: z.number().int().positive(), discount_pct: z.number().min(0).max(100).optional() });
const BundleArgs = z.object({ anchor_sku_id: z.string().min(1), addon_sku_id: z.string().min(1), qty: z.number().int().positive().optional() });
const CheckoutArgs = z.object({ offer_id: z.string().min(1) });

function offerPayload(r: OfferResult) {
  return {
    offer_id: r.offer.id,
    items: r.skus.map((s) => ({ sku_id: s.id, name: s.name, price: formatINR(s.price_paise) })),
    qty: r.offer.qty,
    total: formatINR(r.offer.total_paise),
    total_paise: r.offer.total_paise,
    verdict: r.verdict.decision,
    reason_code: r.verdict.reason_code,
    human_reason: r.verdict.human_reason,
    counter: r.verdict.counter ? { max_total: formatINR(r.verdict.counter.max_total_paise), suggestion: r.verdict.counter.suggestion } : undefined,
  };
}

async function runTool(
  name: string,
  rawArgs: string,
  input: SellerTurnInput,
  session: SessionState,
  events: VerdictEvent[],
  sink: { offer: Offer | null; order: Order | null },
): Promise<unknown> {
  let args: unknown;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { error: "arguments were not valid JSON" };
  }
  const catalog = listSkus();

  if (name === "search_catalog") {
    const a = SearchArgs.safeParse(args);
    if (!a.success) return { error: "query is required" };
    const hits = await searchCatalog(a.data.query, 5);
    return {
      results: hits.map((h) => ({ sku_id: h.sku.id, name: h.sku.name, price: formatINR(h.sku.price_paise), in_stock: h.sku.stock > 0, category: h.sku.category, tags: h.sku.tags })),
    };
  }
  if (name === "get_offer") {
    const a = OfferArgs.safeParse(args);
    if (!a.success) return { error: "sku_ids[] and qty are required" };
    const r = makeOffer({ mandate: input.mandate, sku_ids: a.data.sku_ids, qty: a.data.qty, discount_pct: a.data.discount_pct, actor: "seller_agent", now: input.now });
    events.push(eventFor(r));
    sink.offer = r.offer;
    session.last_offer_id = r.offer.id;
    session.anchor_sku_id = r.offer.sku_ids[0];
    return offerPayload(r);
  }
  if (name === "propose_bundle") {
    if (session.upsell_done) return { error: "The one bundle upsell for this conversation was already made." };
    const a = BundleArgs.safeParse(args);
    if (!a.success) return { error: "anchor_sku_id and addon_sku_id are required" };
    if (!catalog.some((s) => s.id === a.data.addon_sku_id)) return { error: "addon_sku_id not in catalog" };
    session.upsell_done = true;
    const r = makeOffer({ mandate: input.mandate, sku_ids: [a.data.anchor_sku_id, a.data.addon_sku_id], qty: a.data.qty ?? 1, is_bundle: true, actor: "seller_agent", now: input.now });
    events.push(eventFor(r));
    sink.offer = r.offer;
    session.last_offer_id = r.offer.id;
    session.anchor_sku_id = r.offer.sku_ids[0];
    return offerPayload(r);
  }
  if (name === "finalize_checkout") {
    const a = CheckoutArgs.safeParse(args);
    if (!a.success) return { error: "offer_id is required" };
    const offer = getOffer(a.data.offer_id);
    const result = await checkout({ mandate: input.mandate, offer_id: a.data.offer_id, now: input.now });
    events.push({ action: "checkout", verdict: result.verdict, amount_paise: offer?.total_paise ?? 0, offer_id: a.data.offer_id, ledger_entry_id: result.entry.id });
    if (result.ok) {
      sink.order = result.order;
      return { status: result.order.status, total: formatINR(result.order.amount_paise), payment_url: result.order.payment_url, verdict: result.verdict.decision, human_reason: result.verdict.human_reason };
    }
    return { status: "REFUSED", verdict: result.verdict.decision, reason_code: result.verdict.reason_code, human_reason: result.verdict.human_reason };
  }
  return { error: `unknown tool ${name}` };
}

function toOpenAIHistory(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "buyer" ? "user" : "assistant", content: m.content }) as OpenAI.ChatCompletionMessageParam);
}

async function llmTurn(input: SellerTurnInput): Promise<SellerTurnResult | null> {
  const session: SessionState = { ...input.session, messages: [...input.session.messages, { role: "buyer", content: input.message }] };
  const events: VerdictEvent[] = [];
  const sink: { offer: Offer | null; order: Order | null } = { offer: null, order: null };
  const signals = injectionSignals(input.message);
  const history: OpenAI.ChatCompletionMessageParam[] = toOpenAIHistory(session.messages);
  const system = `${SELLER_SYSTEM_PROMPT(merchantName())}\nBuyer mandate: cap ${formatINR(input.mandate.spend_cap_paise)}, scope ${input.mandate.category_scope.join(", ")}.${session.upsell_done ? " The one bundle upsell has already been made." : ""}`;

  for (let round = 0; round < 5; round += 1) {
    const message = await chatWithTools({ model: "heavy", system, messages: history, tools: TOOLS, temperature: 0.4, timeoutMs: 25_000 });
    if (!message) return null;
    history.push(message as OpenAI.ChatCompletionMessageParam);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      const text = message.content?.trim();
      if (!text) return null;
      const next: SessionState = { ...session, messages: [...session.messages, { role: "seller", content: text }] };
      persistSession(next);
      return { reply: text, events, offer: sink.offer, order: sink.order, mode: "openai", session: next, injection_signals: signals };
    }
    for (const call of calls) {
      if (call.type !== "function") continue;
      const result = await runTool(call.function.name, call.function.arguments, input, session, events, sink);
      history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export async function sellerTurn(input: SellerTurnInput): Promise<SellerTurnResult> {
  if (llmMode() === "openai") {
    try {
      const result = await llmTurn(input);
      if (result) return result;
    } catch (err) {
      tripBreaker(err);
    }
  }
  return deterministicTurn(input);
}
