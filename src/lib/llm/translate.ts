import { getTranslation, setTranslation } from "../db";
import { formatINR } from "../money";
import type { LedgerEntry } from "../schemas";
import { chatText, llmMode } from "./router";

/**
 * Shopkeeper view of the ledger: one warm Hinglish sentence per entry.
 * The model rewrites when available; otherwise deterministic templates cover every
 * verdict/reason pair. Either way the sentence is cached by entry id.
 */

const MAX_WORDS = 20;

/** The spec's translator prompt, verbatim, as the system message. */
export function translatorPrompt(entry: LedgerEntry): string {
  let checks: unknown = [];
  try {
    checks = JSON.parse(entry.policy_checks_json);
  } catch {
    checks = [];
  }
  const json = JSON.stringify({
    id: entry.id,
    ts: entry.ts,
    actor: entry.actor,
    mandate_id: entry.mandate_id,
    action: entry.action,
    amount_paise: entry.amount_paise,
    verdict: entry.verdict,
    reason_code: entry.reason_code,
    human_reason: entry.human_reason,
    policy_checks: checks,
  });
  return `Rewrite this ledger entry as ONE warm sentence (≤20 words) a shopkeeper instantly understands. Hinglish allowed. Never invent details not in the entry. Entry: ${json}`;
}

const isWord = (token: string): boolean => /[\p{L}\p{N}]/u.test(token);

export function countWords(text: string): number {
  return text.split(/\s+/).filter(isWord).length;
}

function clampWords(text: string, max = MAX_WORDS): string {
  const tokens = text.trim().split(/\s+/);
  let words = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (isWord(tokens[i])) words += 1;
    if (words > max) {
      const kept = tokens.slice(0, i);
      while (kept.length > 0 && !isWord(kept[kept.length - 1])) kept.pop();
      return `${kept.join(" ")}…`;
    }
  }
  return tokens.join(" ");
}

/* ------------------------------------------------------------------ */
/*  Parsing hints out of the engine's human_reason                     */
/* ------------------------------------------------------------------ */

const RUPEE_RE = /₹[\d,]+(?:\.\d{1,2})?/g;
const PCT_RE = /(\d+(?:\.\d+)?)\s*%/g;

function rupeeMentions(text: string): string[] {
  return text.match(RUPEE_RE) ?? [];
}

/** A limit quoted in the reason that is not the entry's own amount. */
function limitMention(entry: LedgerEntry): string | null {
  const own = formatINR(entry.amount_paise);
  const other = rupeeMentions(entry.human_reason).filter((m) => m !== own);
  return other.length > 0 ? other[other.length - 1] : null;
}

function pctMentions(text: string): string[] {
  return [...text.matchAll(PCT_RE)].map((m) => m[1]);
}

function hinglishList(list: string): string {
  return list.replace(/\s+and\s+/g, " aur ");
}

/* ------------------------------------------------------------------ */
/*  Templates                                                          */
/* ------------------------------------------------------------------ */

function reasonTemplate(entry: LedgerEntry): string | null {
  const amt = formatINR(entry.amount_paise);
  const limit = limitMention(entry);
  const reason = entry.human_reason;

  switch (entry.reason_code) {
    case "OK":
      return `${amt} ka order rules ke andar hai — sab theek, aage badhao.`;
    case "SPEND_CAP_EXCEEDED":
      return limit
        ? `Buyer ki limit ${limit} thi, ${amt} nahi — humne ${limit} tak ka offer diya.`
        : `${amt} buyer ki limit se zyada tha — humne limit ke andar counter offer diya.`;
    case "PRICE_FLOOR":
      return limit
        ? `${amt} humare minimum se neeche tha — humne ${limit} ka counter diya.`
        : `${amt} minimum price se kam tha — humne minimum par counter offer diya.`;
    case "DISCOUNT_LIMIT": {
      const [asked, max] = pctMentions(reason);
      return asked && max
        ? `${asked}% discount maanga, hum sirf ${max}% dete hain — ${amt} par counter bhej diya.`
        : `${amt} par discount limit se zyada maanga — humne allowed discount par counter diya.`;
    }
    case "QTY_LIMIT": {
      const m = reason.match(/Max (\d+) per order; (\d+) requested/);
      return m
        ? `Ek order mein sirf ${m[1]} chalte hain, ${m[2]} nahi — ${m[1]} ka counter diya.`
        : `Ek order ki quantity limit se zyada maanga — humne limit tak ka counter diya.`;
    }
    case "HIGH_VALUE_REVIEW":
      return `${amt} ka bada order hai — aapki manzoori chahiye.`;
    case "CATEGORY_OUT_OF_SCOPE": {
      const m = reason.match(/^(.+?) is (.+?) — this shop only sells (.+?) to AI buyers/);
      if (!m) return `Yeh item AI ki allowed category se bahar hai — ${amt} ka order mana kar diya.`;
      const item = entry.amount_paise > 0 ? `${amt} ka ${m[1]}` : m[1];
      return `${item} ${m[2]} hai, AI sirf ${hinglishList(m[3])} bech sakta hai — mana kar diya.`;
    }
    case "SKU_NOT_FOUND":
      return `Yeh item catalog mein hai hi nahi — ${amt} ka order mana kar diya.`;
    case "MANDATE_EXPIRED":
      return `Buyer ka mandate expire ho gaya — ${amt} ka order mana kar diya.`;
    case "MANDATE_REPLAY":
      return `Yeh mandate pehle hi use ho chuka — ${amt} ki dobara payment mana kar di.`;
    case "ORDER_VALUE_LIMIT":
      return limit
        ? `${amt} aapki per-order limit ${limit} se upar hai — mana kar diya.`
        : `${amt} aapki per-order limit se upar hai — mana kar diya.`;
    default:
      return null;
  }
}

function actionTemplate(entry: LedgerEntry): string | null {
  const amt = formatINR(entry.amount_paise);
  const action = entry.action.toLowerCase();
  if (/reject/.test(action)) return `Aapne ${amt} ka order reject kiya — buyer ko bata diya.`;
  if (/approv/.test(action)) return `Aapne ${amt} ka order approve kiya — payment link bhej diya.`;
  if (/mandate/.test(action)) return `Buyer agent ko ${amt} tak ka mandate mila — shopping shuru.`;
  if (/live|policy|onboard|catalog/.test(action)) return "Dukaan live hai — AI buyers ab aa sakte hain.";
  if (/fallback|link/.test(action)) return `${amt} ke liye naya payment link bhej diya — dobara try ho raha hai.`;
  return null;
}

function verdictTemplate(entry: LedgerEntry): string {
  const amt = formatINR(entry.amount_paise);
  switch (entry.verdict) {
    case "ALLOW":
      return `${amt} ka action rules ke andar hai — sab theek.`;
    case "COUNTER":
      return `${amt} rules ke bahar tha — humne rules ke andar counter offer diya.`;
    case "GATE":
      return `${amt} ka order aapki manzoori ka intezaar kar raha hai.`;
    case "DENY":
      return `${amt} ka order rules ke against tha — mana kar diya.`;
    case "PAID":
      return `${amt} aa gaye — payment ho gayi, order pakka.`;
    case "FAILED":
      return `Bank ne ${amt} ki payment fail ki — order hold par ja raha hai.`;
    case "HELD":
      return `Bank ne ${amt} ki payment fail ki, order rok liya — naya link bhej diya.`;
    case "INFO":
      return actionTemplate(entry) ?? clampWords(`Note: ${entry.human_reason}`);
  }
}

/** Deterministic Hinglish sentence for any ledger entry, ≤20 words. */
export function templateTranslate(entry: LedgerEntry): string {
  const isDecision = ["ALLOW", "COUNTER", "GATE", "DENY"].includes(entry.verdict);
  const text = (isDecision ? reasonTemplate(entry) ?? actionTemplate(entry) : null) ?? verdictTemplate(entry);
  return clampWords(text);
}

/* ------------------------------------------------------------------ */
/*  Model path + cache                                                 */
/* ------------------------------------------------------------------ */

/** One clean line within the word budget, or null so the template takes over. */
function modelSentence(text: string | null): string | null {
  if (!text) return null;
  const line = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“']+|["”']+$/g, "");
  return line.length > 0 && countWords(line) <= MAX_WORDS ? line : null;
}

async function translateUncached(entry: LedgerEntry): Promise<string> {
  if (llmMode() !== "openai") return templateTranslate(entry);
  const text = await chatText({ model: "light", system: translatorPrompt(entry), messages: [], temperature: 0, max_tokens: 80 });
  return modelSentence(text) ?? templateTranslate(entry);
}

export async function translateEntry(entry: LedgerEntry): Promise<string> {
  const cached = getTranslation(entry.id);
  if (cached) return cached;
  const text = await translateUncached(entry);
  setTranslation(entry.id, text);
  return text;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Entry id → sentence; cache hits are served first, misses are translated a few at a time. */
export async function translateMany(entries: LedgerEntry[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const misses: LedgerEntry[] = [];
  for (const e of entries) {
    const cached = getTranslation(e.id);
    if (cached) result.set(e.id, cached);
    else misses.push(e);
  }
  const texts = await mapLimit(misses, 4, translateUncached);
  misses.forEach((entry, i) => {
    setTranslation(entry.id, texts[i]);
    result.set(entry.id, texts[i]);
  });
  return result;
}
