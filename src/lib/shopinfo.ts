import { getMerchant, getPolicy, listSkus } from "./db";
import { formatINR } from "./money";
import type { Policy, Sku } from "./schemas";

/**
 * Grounded answers about the shop itself — the rulebook, returns, delivery
 * scope and product details. The corpus is built fresh from the live policy
 * and catalog on every question (it is tiny), scored with plain keyword
 * overlap, and the caller must answer ONLY from what comes back. Questions
 * about the shop are not money actions: nothing here touches the engine or
 * the ledger.
 */

export interface ShopChunk {
  /** shown to the buyer as the citation, e.g. "Rulebook · Returns" */
  source: string;
  text: string;
}

export interface ScoredChunk extends ShopChunk {
  score: number;
}

export interface ShopAnswer {
  /** a direct answer for the scripted seller; null when nothing matched well */
  answer: string | null;
  citations: ShopChunk[];
  /** everything that scored, for the LLM tool result */
  chunks: ScoredChunk[];
}

export function buildShopChunks(policy: Policy, skus: Sku[], merchantName: string): ShopChunk[] {
  const chunks: ShopChunk[] = [
    { source: "Rulebook · Returns", text: `Return policy: ${policy.refund_policy}` },
    {
      source: "Rulebook · Pricing",
      text: `Minimum price protection: offers never go below ${policy.price_floor_pct}% of the list price. Maximum discount: ${policy.max_discount_pct}%.`,
    },
    {
      source: "Rulebook · Order limits",
      text: `At most ${policy.max_qty_per_order} items per order. Orders above ${formatINR(policy.gate_above_paise)} wait for the owner's approval. The biggest order allowed is ${formatINR(policy.max_order_value_paise)}.`,
    },
    {
      source: "Rulebook · Categories",
      text: `AI buyers may buy these categories: ${policy.category_allowlist.join(", ") || "none"}. Anything else is politely refused.`,
    },
    { source: "Shop", text: `${merchantName} is a small Indian shop selling ${[...new Set(skus.map((s) => s.category))].join(", ")}.` },
  ];
  for (const s of skus) {
    chunks.push({
      source: `Catalog · ${s.name}`,
      text: `${s.name} (${s.category}): ${s.description || "no description"}. Price ${formatINR(s.price_paise)}, ${s.stock} in stock. Tags: ${s.tags.join(", ")}.`,
    });
  }
  return chunks;
}

const STOP = new Set([
  "the", "a", "an", "is", "are", "do", "does", "you", "your", "what", "whats", "how", "can", "i", "we", "of", "for", "on", "in", "to", "have", "has", "please", "tell", "me", "about", "any", "there", "it", "this", "that",
  "kya", "hai", "ka", "ki", "ke", "aap", "apki", "apka", "mujhe", "batao", "bataiye", "koi", "क्या", "है", "का", "की", "के", "आपकी", "आपका", "मुझे", "बताइए", "कोई",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}%₹]+/u) // \p{M}: Devanagari vowel signs are combining marks, not letters
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Hinglish/Hindi ↔ English synonyms so "वापसी" finds the returns chunk. */
const SYNONYMS: Record<string, string[]> = {
  return: ["returns", "refund", "wapsi", "वापसी", "लौटाना", "exchange", "badalna"],
  discount: ["chhoot", "छूट", "off", "concession", "kam"],
  price: ["daam", "दाम", "keemat", "कीमत", "rate", "floor", "minimum"],
  order: ["ऑर्डर", "limit", "seema", "सीमा", "quantity", "items", "qty"],
  category: ["श्रेणी", "categories", "scope", "sell", "bechte", "बेचते"],
  delivery: ["shipping", "भेजना", "deliver", "pahunchana"],
};

/**
 * Question terms with weights: a word from a triggered synonym group (the
 * topic — "discount", "return"…) counts 3, so it beats incidental overlaps
 * like "most" or "allowed" that appear in unrelated chunks.
 */
function weightedTerms(question: string): Map<string, number> {
  const words = terms(question);
  const out = new Map<string, number>(words.map((w) => [w, 1]));
  for (const [canon, alts] of Object.entries(SYNONYMS)) {
    if (words.includes(canon) || alts.some((a) => words.includes(a))) {
      out.set(canon, 3);
      alts.forEach((a) => out.set(a, 3));
    }
  }
  return out;
}

export function scoreChunks(question: string, chunks: ShopChunk[]): ScoredChunk[] {
  const qTerms = weightedTerms(question);
  return chunks
    .map((c) => {
      const cTerms = new Set(terms(`${c.source} ${c.text}`));
      let score = 0;
      for (const t of cTerms) score += qTerms.get(t) ?? 0;
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** True when the line asks about the shop/rules rather than proposing to buy. */
export function isShopQuestion(message: string): boolean {
  const m = message.toLowerCase();
  return /return|refund|exchange|policy|deliver|shipping|discount.*(polic|rule|limit|allowed|max)|(polic|rule).*(discount)|wapsi|वापसी|छूट.*(कितनी|नियम)|नियम|policy kya/.test(m);
}

export function answerShopInfo(question: string, topK = 3): ShopAnswer {
  const policy = getPolicy();
  const skus = listSkus();
  const merchant = getMerchant()?.name ?? "the shop";
  if (!policy) return { answer: null, citations: [], chunks: [] };

  const scored = scoreChunks(question, buildShopChunks(policy, skus, merchant)).slice(0, topK);
  if (scored.length === 0) return { answer: null, citations: [], chunks: [] };

  // The scripted seller answers with the single best chunk, verbatim — grounded by construction.
  const best = scored[0];
  return {
    answer: best.text,
    citations: [{ source: best.source, text: best.text }],
    chunks: scored,
  };
}
