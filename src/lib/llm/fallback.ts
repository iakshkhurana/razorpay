import { formatINR } from "../money";
import type { Verdict } from "../schemas";

/**
 * Scripted seller used whenever the model is unavailable (no key, outage, breaker
 * open). Pure text policy: the API layer runs search, offers and the policy engine,
 * then hands the results in. This module never sees the database or a payment.
 */

export interface FallbackHit {
  name: string;
  price_paise: number;
  sku_id: string;
  in_stock: boolean;
}

export interface FallbackOffer {
  total_paise: number;
  sku_names: string[];
  is_bundle: boolean;
  verdict: Verdict;
  offer_id?: string;
}

export interface FallbackContext {
  merchant_name: string;
  buyer_message: string;
  hits: FallbackHit[];
  offer?: FallbackOffer;
  upsell_already_done: boolean;
  /** 1-based count of buyer messages in this session */
  turn: number;
}

export type FallbackIntent =
  | "greet"
  | "present_offer"
  | "present_counter"
  | "gate_notice"
  | "deny_alternative"
  | "confirm_close"
  | "clarify";

export interface FallbackReply {
  text: string;
  intent: FallbackIntent;
  /** The API layer should build a saree + blouse bundle offer for the next turn. */
  wants_bundle_offer: boolean;
}

export type BuyerIntent = "accept" | "haggle" | "ask" | "reject" | "other";

/* ------------------------------------------------------------------ */
/*  Buyer message analysis                                             */
/* ------------------------------------------------------------------ */

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|per cent|pratishat)/i;
const DISCOUNT_OF_RE = /(?:discount|chhoot|choot)\s*(?:of\s+)?(\d{1,3}(?:\.\d+)?)\b(?!\s*(?:rupees|rs|₹|paise))/i;

export function extractRequestedDiscountPct(message: string): number | null {
  const match = message.match(PERCENT_RE) ?? message.match(DISCOUNT_OF_RE);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value;
}

/**
 * An "accept" hands the last ALLOW offer to checkout, so the detector errs
 * towards not closing: explicit rejections win, an acceptance phrased as a
 * question needs an action verb, and the weak "ok / sure / fine" words only
 * count when they open a message that is not itself a new request.
 */
const STRONG_REJECT_RE =
  /\b(not interested|too expensive|too pricey|too costly|cancel|leave it|forget it|never ?mind|drop it|rehne do|nahi chahiye|no thanks?)\b|^\W*(no|nope|nah|nahi|nahin)\b/i;
const ACTION_ACCEPT_RE = /\b(go ahead|take it|i'?ll take|i'?ll go with|go with (?:that|your|the)|book it|proceed|check ?out|buy it|lock it in)\b/i;
const STRONG_ACCEPT_RE = /\b(deal|done|let'?s do it|accept(?:ed)?|pakka)\b/i;
const HAGGLE_RE =
  /\b(discount|cheaper|cheap|lower|less|best price|last price|final price|kam karo|kam kar do|sasta|reduce|bargain|negotiate|any offer|better price|price down)\b/i;
const PLAIN_NO_RE = /\b(no|nope|nah|nahi|nahin|skip)\b/i;
const WEAK_ACCEPT_RE = /^\W*(yes|yeah|yep|yup|ok|okay|sure|haan(?: ji)?|theek hai|fine|agreed|great|perfect|confirm(?:ed)?|sounds good)\b/i;
const REQUEST_RE =
  /\b(i'?d like|i want|i need|looking for|do you have|show me|what about|how about|instead|suggest|can you|could you|tell me)\b/i;
const ASK_RE =
  /\?|\b(what|which|do you have|show|looking for|need|want|i'?d like|price of|how much|kya|any|options|recommend|suggest|tell me|gift|for my|budget|kitna)\b/i;

function normaliseQuotes(text: string): string {
  return text.replace(/[‘’`]/g, "'");
}

export function detectBuyerIntent(message: string): BuyerIntent {
  const text = normaliseQuotes(message.trim());
  if (!text) return "other";
  const question = text.includes("?");
  if (extractRequestedDiscountPct(text) !== null) return "haggle";
  if (STRONG_REJECT_RE.test(text)) return "reject";
  if (ACTION_ACCEPT_RE.test(text) || (!question && STRONG_ACCEPT_RE.test(text))) return "accept";
  if (HAGGLE_RE.test(text)) return "haggle";
  if (PLAIN_NO_RE.test(text)) return "reject";
  if (!question && WEAK_ACCEPT_RE.test(text) && !REQUEST_RE.test(text)) return "accept";
  if (ASK_RE.test(text)) return "ask";
  return "other";
}

const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bignore\b.{0,30}\b(rules?|instructions?|polic(?:y|ies)|prompt|limits?|mandate)\b/i, "ignore_rules"],
  [/\b(disregard|forget|bypass|skip)\b.{0,30}\b(rules?|instructions?|polic(?:y|ies)|checks?|limits?)\b/i, "ignore_rules"],
  [/\b(merchant|owner|malik|ramesh|shopkeeper|dukaandar)\s*(?:ji)?\s*ne\s*(bola|kaha|bol diya|keh diya|approve kiya)\b/i, "claimed_owner_approval"],
  [/\bas the (owner|merchant|shopkeeper|admin|manager)\b|\bi am the (owner|merchant|shopkeeper|admin)\b/i, "owner_impersonation"],
  [/(^|\s)(system|developer|assistant)\s*:/i, "fake_system_message"],
  [/\b(tool|function)\s*(output|result|response|call)s?\b|\bsearch_catalog\s+returned\b|\bget_offer\s+returned\b/i, "fake_tool_output"],
  [/\boverride\b/i, "override"],
  [/\b(jailbreak|developer mode|new instructions|you are now|pretend (?:you|to be))\b/i, "instruction_override"],
  [/\b(free of (?:cost|charge)|for free|100\s*%\s*off|zero rupees|₹\s*0\b)\b/i, "free_demand"],
];

/** Labels for known manipulation phrases; logged, never acted upon. */
export function injectionSignals(message: string): string[] {
  const text = normaliseQuotes(message);
  const found = new Set<string>();
  for (const [re, label] of INJECTION_PATTERNS) {
    if (re.test(text)) found.add(label);
  }
  return [...found];
}

/* ------------------------------------------------------------------ */
/*  Reply composition                                                  */
/* ------------------------------------------------------------------ */

function joinNames(names: string[]): string {
  if (names.length === 0) return "this";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function endsWithPunctuation(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function greeting(ctx: FallbackContext): string {
  return ctx.turn <= 1 ? `Namaste ji, welcome to ${ctx.merchant_name}.` : "";
}

function sentences(...parts: string[]): string {
  return parts.filter((p) => p.trim().length > 0).join(" ");
}

const SAREE_RE = /saree|sari/i;
const BLOUSE_RE = /blouse/i;

function suggestsSaree(ctx: FallbackContext, offer: FallbackOffer): boolean {
  if (offer.sku_names.some((n) => BLOUSE_RE.test(n))) return false;
  const candidates = [...offer.sku_names, ...ctx.hits.slice(0, 3).map((h) => h.name)];
  return candidates.some((n) => SAREE_RE.test(n));
}

function presentOffer(ctx: FallbackContext, offer: FallbackOffer): FallbackReply {
  const items = joinNames(offer.sku_names);
  const total = formatINR(offer.total_paise);
  const body = offer.is_bundle
    ? `I can do ${items} together for ${total} — all within your mandate.`
    : `${items} ${offer.sku_names.length > 1 ? "are" : "is"} yours for ${total}, well within your mandate.`;

  const wantsBundle = !ctx.upsell_already_done && !offer.is_bundle && suggestsSaree(ctx, offer);
  let pairing = "";
  if (wantsBundle) {
    const blouse = ctx.hits.find((h) => BLOUSE_RE.test(h.name) && h.in_stock);
    pairing = blouse
      ? `Many buyers pair it with our ${blouse.name} at ${formatINR(blouse.price_paise)} — shall I add one?`
      : "Many buyers pair it with a matching blouse piece — shall I add one?";
  }
  return {
    text: sentences(greeting(ctx), body, pairing),
    intent: "present_offer",
    wants_bundle_offer: wantsBundle,
  };
}

function confirmClose(offer: FallbackOffer): FallbackReply {
  const items = joinNames(offer.sku_names);
  return {
    text: `Deal done ji — ${items} for ${formatINR(offer.total_paise)}, confirmed 🎉. Sending you the payment link now.`,
    intent: "confirm_close",
    wants_bundle_offer: false,
  };
}

function presentCounter(offer: FallbackOffer): FallbackReply {
  const { verdict } = offer;
  const apology = `Sorry ji, ${formatINR(offer.total_paise)} doesn't fit here.`;
  if (!verdict.counter) {
    return {
      text: sentences(apology, endsWithPunctuation(verdict.human_reason)),
      intent: "present_counter",
      wants_bundle_offer: false,
    };
  }
  const max = formatINR(verdict.counter.max_total_paise);
  return {
    text: sentences(apology, endsWithPunctuation(verdict.counter.suggestion), `My counter is ${max} — shall we go with that?`),
    intent: "present_counter",
    wants_bundle_offer: false,
  };
}

function gateNotice(offer: FallbackOffer): FallbackReply {
  const items = joinNames(offer.sku_names);
  return {
    text: sentences(
      endsWithPunctuation(offer.verdict.human_reason),
      `The shop owner will confirm shortly — I've kept ${items} for ${formatINR(offer.total_paise)} aside for you.`,
    ),
    intent: "gate_notice",
    wants_bundle_offer: false,
  };
}

function firstAlternative(ctx: FallbackContext, exclude: string[]): FallbackHit | undefined {
  const excluded = new Set(exclude.map((n) => n.toLowerCase()));
  return ctx.hits.find((h) => h.in_stock && !excluded.has(h.name.toLowerCase()));
}

function denyWithAlternative(ctx: FallbackContext, offer: FallbackOffer): FallbackReply {
  const alt = firstAlternative(ctx, offer.sku_names);
  const reason = `Sorry ji, I can't sell that one: ${endsWithPunctuation(offer.verdict.human_reason)}`;
  const suggestion = alt
    ? `How about the ${alt.name} at ${formatINR(alt.price_paise)} instead?`
    : "Tell me the occasion and I'll find something in scope for you.";
  return { text: sentences(reason, suggestion), intent: "deny_alternative", wants_bundle_offer: false };
}

function replyToOffer(ctx: FallbackContext, offer: FallbackOffer, intent: BuyerIntent): FallbackReply {
  switch (offer.verdict.decision) {
    case "ALLOW":
      return intent === "accept" ? confirmClose(offer) : presentOffer(ctx, offer);
    case "COUNTER":
      return presentCounter(offer);
    case "GATE":
      return gateNotice(offer);
    case "DENY":
      return denyWithAlternative(ctx, offer);
  }
}

const HELLO_RE = /^\s*(hi|hello|hey|namaste|namaskar|hola|good (?:morning|afternoon|evening))\b/i;

function replyWithoutOffer(ctx: FallbackContext, intent: BuyerIntent): FallbackReply {
  const merchant = ctx.merchant_name;
  const clarify = (text: string): FallbackReply => ({ text, intent: "clarify", wants_bundle_offer: false });

  if (intent === "reject") {
    return clarify("No problem ji — tell me what would suit better and I'll look again.");
  }

  const top = ctx.hits.find((h) => h.in_stock);
  if (top) {
    const pitch = `Our ${top.name} at ${formatINR(top.price_paise)} would be a lovely fit — shall I put together an offer?`;
    return {
      text: sentences(greeting(ctx), pitch),
      intent: ctx.turn <= 1 ? "greet" : "present_offer",
      wants_bundle_offer: false,
    };
  }
  if (ctx.hits.length > 0) {
    return clarify(
      `${ctx.hits[0].name} is out of stock right now — tell me a bit more about what you need and I'll suggest something else.`,
    );
  }

  if (injectionSignals(ctx.buyer_message).length > 0) {
    return clarify("I can only quote what's in the catalog at the shop's own rules — tell me what you'd like and I'll find it.");
  }
  if (HELLO_RE.test(ctx.buyer_message) || (ctx.turn <= 1 && intent === "other")) {
    return {
      text: `Namaste ji, welcome to ${merchant}! Tell me what you're shopping for — the occasion or a budget helps.`,
      intent: "greet",
      wants_bundle_offer: false,
    };
  }
  return clarify(`I couldn't find that in ${merchant}'s catalog — could you tell me a bit more, like the occasion or your budget?`);
}

/**
 * Deterministic seller turn. Honours the verdict the API layer already obtained;
 * never quotes a price that did not arrive in `hits` or `offer`.
 */
export function fallbackSellerReply(ctx: FallbackContext): FallbackReply {
  const intent = detectBuyerIntent(ctx.buyer_message);
  if (ctx.offer) return replyToOffer(ctx, ctx.offer, intent);
  return replyWithoutOffer(ctx, intent);
}
