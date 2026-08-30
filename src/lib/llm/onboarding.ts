import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { pickEmoji, skusFromCsv, slugify } from "../catalog";
import { formatINR, rupeesToPaise } from "../money";
import { DEFAULT_POLICY, PolicyPatchSchema, SkuSchema, type Policy, type PolicyPatch, type Sku } from "../schemas";
import { chatJson, llmMode } from "./router";

/* ------------------------------------------------------------------ */
/*  Catalog extraction                                                 */
/* ------------------------------------------------------------------ */

export type CatalogSource = "csv" | "url" | "llm" | "fallback";

export interface ExtractCatalogInput {
  url?: string;
  csv?: string;
  merchant_name?: string;
}

export interface ExtractedCatalog {
  merchant_name: string;
  skus: Sku[];
  policy: Policy;
  source: CatalogSource;
}

const DEFAULT_MERCHANT_NAME = "Ramesh Handlooms";
const FETCH_TIMEOUT_MS = 10_000;
const PAGE_TEXT_CAP = 20_000;

/** Mirror of data/seed/ramesh-catalog.csv so a missing file can never dead-end onboarding. */
const SEED_CSV = `name,description,price_inr,stock,category,tags
Cotton Handloom Saree,Soft daily-wear handloom saree in pastel shades,1499,15,handloom,"saree,cotton,gift,daily"
Matching Blouse Piece,Unstitched blouse fabric matched to our sarees,350,40,handloom,"blouse,addon,matching"
Phulkari Dupatta,Hand-embroidered Patiala phulkari dupatta,1299,12,handloom,"dupatta,phulkari,wedding,gift"
Banarasi Silk Saree,Rich zari-work Banarasi silk for occasions,4999,6,handloom,"saree,silk,banarasi,wedding"
Zari Border Saree,Elegant saree with golden zari border,2799,9,handloom,"saree,zari,festive,gift"
Handwoven Stole,Light handwoven stole in earthy tones,649,20,handloom,"stole,gift,winter"
Brass Diya Gift Set,Set of 4 engraved brass diyas in gift box,499,25,gifts,"diya,brass,festive,gift"
Punjabi Jutti Gold,Hand-crafted golden jutti with embroidery,899,10,footwear,"jutti,ethnic,wedding"
`;

export function seedCatalog(): Sku[] {
  try {
    const file = path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv");
    const skus = skusFromCsv(fs.readFileSync(file, "utf8"));
    if (skus.length > 0) return skus;
  } catch {
    /* fall through to the embedded copy */
  }
  return skusFromCsv(SEED_CSV);
}

/** "Rs. 1,299.00" → 1299; anything without digits stays as-is and fails validation. */
const looseRupees = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : v;
}, z.number().nonnegative());

const looseStock = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const n = Number.parseInt(v.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 10;
}, z.number().int().nonnegative());

const ExtractedSkuSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  price_inr: looseRupees,
  stock: looseStock.default(10),
  category: z.string().min(1).default("general"),
  tags: z.array(z.string()).default([]),
  image_emoji: z.string().min(1).optional(),
});
type ExtractedSku = z.infer<typeof ExtractedSkuSchema>;

const EnrichmentHintSchema = z.object({
  id: z.string().min(1),
  image_emoji: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
});

/** Model replies are validated row by row so one malformed item never discards the rest. */
const SkuListSchema = z.object({ skus: z.array(z.unknown()) });

function validRows<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, rows: unknown[]): T[] {
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

function isEmoji(candidate: string | undefined): candidate is string {
  if (!candidate) return false;
  const glyphs = [...candidate.trim()];
  return glyphs.length > 0 && glyphs.length <= 3 && !/[\p{L}\p{N}\s]/u.test(candidate);
}

function cleanCategory(raw: string | undefined, fallback = "general"): string {
  const c = (raw ?? "").trim().toLowerCase();
  return c.length > 0 ? c : fallback;
}

function cleanTags(raw: string[] | undefined): string[] {
  return [...new Set((raw ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

function uniqueId(name: string, seen: Set<string>): string {
  const base = `sku_${slugify(name) || "item"}`;
  let id = base;
  let n = 2;
  while (seen.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  seen.add(id);
  return id;
}

function toSkus(items: ExtractedSku[]): Sku[] {
  const seen = new Set<string>();
  const out: Sku[] = [];
  for (const item of items) {
    const category = cleanCategory(item.category);
    const tags = cleanTags(item.tags);
    const parsed = SkuSchema.safeParse({
      id: uniqueId(item.name, seen),
      name: item.name.trim(),
      description: item.description.trim(),
      price_paise: rupeesToPaise(item.price_inr),
      stock: item.stock,
      tags,
      category,
      image_emoji: isEmoji(item.image_emoji) ? item.image_emoji.trim() : pickEmoji(item.name, tags, category),
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/* ---- page fetching ------------------------------------------------- */

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "text/html,text/csv,text/plain,*/*" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function pageToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim().slice(0, PAGE_TEXT_CAP);
}

/* ---- deterministic page parsers ------------------------------------ */

const LdOfferSchema = z
  .object({
    price: z.union([z.number(), z.string()]).optional(),
    availability: z.string().optional(),
    inventoryLevel: z.union([z.number(), z.object({ value: z.number().optional() }).passthrough()]).optional(),
  })
  .passthrough();

const LdProductSchema = z
  .object({
    "@type": z.union([z.string(), z.array(z.string())]).optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    keywords: z.union([z.string(), z.array(z.string())]).optional(),
    offers: z.union([LdOfferSchema, z.array(LdOfferSchema)]).optional(),
  })
  .passthrough();

function isProductType(t: string | string[] | undefined): boolean {
  const types = Array.isArray(t) ? t : t ? [t] : [];
  return types.some((x) => /product/i.test(x));
}

function walkLd(node: unknown, out: ExtractedSku[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walkLd(n, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if ("@graph" in record) walkLd(record["@graph"], out);
  if ("itemListElement" in record) walkLd(record["itemListElement"], out);
  if ("item" in record) walkLd(record["item"], out);
  const parsed = LdProductSchema.safeParse(record);
  if (!parsed.success || !isProductType(parsed.data["@type"])) return;
  const offers = parsed.data.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const price = offer?.price;
  const priceNum = typeof price === "string" ? Number(price.replace(/[^\d.]/g, "")) : price;
  if (priceNum === undefined || !Number.isFinite(priceNum)) return;
  const inv = offer?.inventoryLevel;
  const invNum = typeof inv === "number" ? inv : inv?.value;
  const outOfStock = /OutOfStock|SoldOut/i.test(offer?.availability ?? "");
  const keywords = parsed.data.keywords;
  const tags = Array.isArray(keywords) ? keywords : keywords ? keywords.split(/[,|;]/) : [];
  out.push({
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    price_inr: priceNum,
    stock: outOfStock ? 0 : (invNum ?? 10),
    category: parsed.data.category ?? "general",
    tags,
  });
}

export function skusFromJsonLd(html: string): Sku[] {
  const found: ExtractedSku[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      walkLd(JSON.parse(match[1]), found);
    } catch {
      /* malformed block: skip */
    }
  }
  return toSkus(found);
}

function looksLikeCsv(body: string): boolean {
  const header = body.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  return !/<\s*(html|body|div|script)/i.test(body.slice(0, 500)) && /name|product|title|item/.test(header) && /price|mrp|rate|amount/.test(header);
}

/* ---- model-backed steps --------------------------------------------- */

const EXTRACT_SYSTEM = `You extract a product catalog for a small Indian shop from raw page text.
Return a JSON object {"skus":[...]} where each item has: name, description (one short line), price_inr (number, rupees), stock (integer; 10 if unknown), category (one lowercase word such as handloom, gifts, footwear, apparel, jewellery, food), tags (3-5 lowercase keywords), image_emoji (exactly one fitting emoji).
Only include products that have a price on the page. Never invent products or prices.`;

async function extractWithModel(text: string): Promise<Sku[]> {
  const result = await chatJson({
    model: "heavy",
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: text }],
    temperature: 0,
    schema: SkuListSchema,
    timeoutMs: 45_000,
  });
  return result ? toSkus(validRows(ExtractedSkuSchema, result.skus)) : [];
}

const ENRICH_SYSTEM = `You tidy a small Indian shop's product catalog.
For each SKU return: id (unchanged), image_emoji (exactly ONE fitting emoji), category (one lowercase word, normalised — e.g. sarees, dupattas and stoles are "handloom"; diyas and gift boxes are "gifts"; juttis are "footwear"), tags (3-5 lowercase keywords).
Return a JSON object {"skus":[...]} with one item per input SKU, same ids, nothing else.`;

async function enrichWithModel(skus: Sku[]): Promise<Sku[]> {
  const payload = skus.map((s) => ({ id: s.id, name: s.name, description: s.description, category: s.category, tags: s.tags }));
  const result = await chatJson({
    model: "heavy",
    system: ENRICH_SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
    temperature: 0,
    schema: SkuListSchema,
  });
  if (!result) return skus;
  const byId = new Map(validRows(EnrichmentHintSchema, result.skus).map((s) => [s.id, s]));
  return skus.map((sku) => {
    const hint = byId.get(sku.id);
    if (!hint) return sku;
    const merged: Sku = {
      ...sku,
      image_emoji: isEmoji(hint.image_emoji) ? hint.image_emoji.trim() : sku.image_emoji,
      category: cleanCategory(hint.category, sku.category),
      tags: hint.tags && hint.tags.length > 0 ? cleanTags(hint.tags) : sku.tags,
    };
    return SkuSchema.safeParse(merged).success ? merged : sku;
  });
}

/* ---- policy drafting -------------------------------------------------- */

const EXCLUDED_CATEGORIES = new Set(["footwear", "shoes", "shoe"]);

function roundUpPaise(paise: number, stepPaise: number): number {
  return Math.ceil(paise / stepPaise) * stepPaise;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Draft policy from the catalog. Footwear stays off the allowlist on purpose: the
 * seed jutti is the demo's clean DENY (CATEGORY_OUT_OF_SCOPE), and a merchant can
 * add it back on the review screen. If excluding it would leave nothing sellable,
 * every category is kept.
 */
export function draftPolicy(skus: Sku[]): Policy {
  const categories = [...new Set(skus.map((s) => s.category.trim().toLowerCase()).filter(Boolean))];
  const allowed = categories.filter((c) => !EXCLUDED_CATEGORIES.has(c));
  const category_allowlist = allowed.length > 0 ? allowed : categories.length > 0 ? categories : DEFAULT_POLICY.category_allowlist;

  const prices = skus.map((s) => s.price_paise);
  const med = median(prices);
  const gate_above_paise = med > DEFAULT_POLICY.gate_above_paise ? roundUpPaise(med * 2, 50_000) : DEFAULT_POLICY.gate_above_paise;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const max_order_value_paise = Math.max(DEFAULT_POLICY.max_order_value_paise, roundUpPaise(maxPrice, 50_000));

  return { ...DEFAULT_POLICY, category_allowlist, gate_above_paise, max_order_value_paise };
}

function merchantNameFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    const label = host.split(".")[0] ?? "";
    const words = label
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    return words.length > 0 ? words.join(" ") : null;
  } catch {
    return null;
  }
}

function finish(merchant_name: string, skus: Sku[], source: CatalogSource): ExtractedCatalog {
  return { merchant_name, skus, policy: draftPolicy(skus), source };
}

async function fromCsv(csv: string): Promise<Sku[]> {
  const skus = skusFromCsv(csv);
  if (skus.length === 0) return [];
  if (llmMode() !== "openai") return skus;
  return enrichWithModel(skus);
}

async function fromUrl(url: string): Promise<{ skus: Sku[]; source: CatalogSource } | null> {
  const body = await fetchPage(url);
  if (!body) return null;
  if (looksLikeCsv(body)) {
    const csv = skusFromCsv(body);
    if (csv.length > 0) return { skus: csv, source: "url" };
  }
  const ld = skusFromJsonLd(body);
  if (ld.length > 0) return { skus: ld, source: "url" };
  if (llmMode() !== "openai") return null;
  const text = pageToText(body);
  if (!text) return null;
  const extracted = await extractWithModel(text);
  return extracted.length > 0 ? { skus: extracted, source: "llm" } : null;
}

/** Messy merchant input → validated SKUs + draft policy. Never throws, never returns an empty catalog. */
export async function extractCatalog(input: ExtractCatalogInput): Promise<ExtractedCatalog> {
  const name = input.merchant_name?.trim() || (input.url ? merchantNameFromUrl(input.url) : null) || DEFAULT_MERCHANT_NAME;

  try {
    if (input.csv?.trim()) {
      const skus = await fromCsv(input.csv);
      if (skus.length > 0) return finish(name, skus, "csv");
      if (llmMode() === "openai") {
        const extracted = await extractWithModel(input.csv.slice(0, PAGE_TEXT_CAP));
        if (extracted.length > 0) return finish(name, extracted, "llm");
      }
    }
    if (input.url?.trim()) {
      const result = await fromUrl(input.url.trim());
      if (result) return finish(name, result.skus, result.source);
    }
  } catch {
    /* every failure lands on the seed catalog below */
  }
  return finish(name, seedCatalog(), "fallback");
}

/* ------------------------------------------------------------------ */
/*  Voice utterance → policy patch                                     */
/* ------------------------------------------------------------------ */

export type PatchSource = "llm" | "rules";

export interface UtterancePatch {
  patch: PolicyPatch;
  spoken_confirmation: string;
  source: PatchSource;
}

const NOT_UNDERSTOOD = "Samajh nahi aaya, dobara boliye.";

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  cheh: 6,
  chah: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  dus: 10,
  pandrah: 15,
  bees: 20,
  pachees: 25,
  pachchis: 25,
  tees: 30,
  chalis: 40,
  chaalis: 40,
  pachas: 50,
  pachaas: 50,
  sattar: 70,
  assi: 80,
  nabbe: 90,
  sau: 100,
};

const MULTIPLIERS: Record<string, number> = {
  hazaar: 1000,
  hazar: 1000,
  hajaar: 1000,
  hajar: 1000,
  thousand: 1000,
  lakh: 100_000,
  lac: 100_000,
  sau: 100,
  hundred: 100,
};

/** Lowercase, digits normalised, number words and percent words rewritten to "N" / "N%". */
export function normaliseUtterance(text: string): string {
  let s = text.toLowerCase();
  s = s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  s = s.replace(/(\d),(?=\d{2,3}\b)/g, "$1");
  s = s.replace(/₹|\brs\.?\b|\brupees?\b|\brupaye\b|\brupiya\b|\brupee\b/g, " ");
  s = s.replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n: string) => String(Number(n) * 1000));
  s = s.replace(/\b(percent|per cent|pratishat|prtishat|parcent|pratishad)\b/g, "%");
  s = s.replace(/(\d)\s+%/g, "$1%");

  const tokens = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const word = token.replace(/[^a-z%.\d]/g, "");
    const prev = out[out.length - 1];
    const prevNum = prev !== undefined && /^\d+$/.test(prev) ? Number(prev) : null;
    /* English "do not / do you" is not the Hindi numeral two */
    if (word === "do" && /^(not|n't|you|we|i|it|this|that|they|the)$/.test(tokens[i + 1] ?? "")) {
      out.push(token);
      continue;
    }
    if (word in MULTIPLIERS && prevNum !== null) {
      out[out.length - 1] = String(prevNum * MULTIPLIERS[word]);
      continue;
    }
    if (word in MULTIPLIERS && word !== "sau" && word !== "hundred") {
      out.push(String(MULTIPLIERS[word]));
      continue;
    }
    if (word in NUMBER_WORDS) {
      out.push(String(NUMBER_WORDS[word]));
      continue;
    }
    out.push(token);
  }
  return out.join(" ");
}

function pctIn(clause: string): number | null {
  const m = clause.match(/(\d{1,3})\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** Largest number in the clause that is not a percentage (rupee amounts dwarf counts). */
function largestPlainNumber(clause: string): number | null {
  let best: number | null = null;
  for (const m of clause.matchAll(/(?<![\d.%])(\d+(?:\.\d+)?)(?!\s*%)(?![\d.])/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best;
}

const REFUND_NO_RE = /\b(no returns?|no refunds?|returns? nahi|refund nahi|wapas nahi|wapsi nahi|koi return nahi|final sale|non[- ]?returnable)\b/;
const REFUND_DAYS_RE =
  /(\d+)\s*(?:din|dino|dinon|days?)\s*(?:ka|ki|ke|me|mein|main|tak|ke andar|within)?\s*(?:return|refund|wapsi|wapas|exchange)|(?:return|refund|wapsi|exchange)s?\s*(?:policy|within|in|me|mein)?\s*(\d+)\s*(?:din|dino|dinon|days?)/;

const CATEGORY_RE = /\b(?:sirf|only|just|keval|bas)\s+([a-z][a-z ,&/-]*?)(?:\s+(?:hi|ko|bech\w*|sell\w*|allowed|allow|karo|karna|rakho|rakhna|dena|dikhao|category|categories|items?|products?|wale|waale|waali)\b|$)/;
const CATEGORY_FILLER = new Set([
  "hi",
  "ko",
  "ka",
  "ki",
  "ke",
  "the",
  "items",
  "item",
  "products",
  "product",
  "category",
  "categories",
  "wale",
  "waale",
  "waali",
  "sell",
  "bech",
  "bechna",
  "bechenge",
  "and",
  "aur",
  "or",
  "ya",
]);

const DISCOUNT_RE = /\b(discount|chhoot|choot|chut|off)\b/;
const FLOOR_RE = /\b(minimum|min|floor|neeche|niche|kam|below|lowest|least)\b/;
const QTY_RE = /\b(order|qty|quantity|piece|pieces|unit|units|items?)\b/;
const MAX_ORDER_RE = /\b(mat lena|mat lo|nahi lena|nahi lenge|max order|maximum order|order limit|order value|not accept|don'?t accept|reject|mat accept|bada order nahi|se zyada ka order nahi)\b/;
const GATE_RE = /\b(pooch\w*|puch\w*|ask|approve\w*|approval|manzoori|manzuri|permission|confirm\w*|gate|review|mujhse|mere se|check with me|batana|batao|bata dena)\b/;

function parseCategories(clause: string): string[] | null {
  if (/\d/.test(clause)) return null;
  const m = clause.match(CATEGORY_RE);
  if (!m) return null;
  const list = m[1]
    .split(/\s*(?:,|&|\/|\baur\b|\band\b|\bor\b|\bya\b)\s*/)
    .map((t) => t.trim().toLowerCase())
    .flatMap((t) => t.split(/\s+/))
    .filter((t) => /^[a-z][a-z-]+$/.test(t) && !CATEGORY_FILLER.has(t));
  return list.length > 0 ? [...new Set(list)] : null;
}

function parseQty(clause: string): number | null {
  const patterns = [
    /\b(?:ek|1|one|har|each|per|every)\s+order\s*(?:me|mein|main|se)?\s*(?:max(?:imum)?\s*)?(\d{1,2})\b/,
    /\b(\d{1,2})\s*(?:se\s+(?:zyada|jyada|adhik|upar)\s+)?(?:pieces?|units?|items?|sarees?)?\s*(?:per|har|\/)\s*order/,
    /\bmax(?:imum)?\s*(?:qty|quantity|pieces?|units?|items?)?\s*(?:of\s+)?(\d{1,2})\b/,
    /\b(?:qty|quantity|pieces?|units?)\s*(?:max(?:imum)?|limit|se zyada|se jyada)?\s*(\d{1,2})\b/,
    /\border\s*(?:me|mein|main)\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s*(?:se\s+(?:zyada|jyada|adhik|upar))/,
  ];
  for (const re of patterns) {
    const m = clause.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n < 100) return n;
    }
  }
  return null;
}

function parseClause(clause: string): PolicyPatch {
  if (REFUND_NO_RE.test(clause)) return { refund_policy: "No returns or refunds." };
  const days = clause.match(REFUND_DAYS_RE);
  if (days) {
    const n = Number(days[1] ?? days[2]);
    if (n > 0) return { refund_policy: `${n}-day easy returns on unused items.` };
  }

  const categories = parseCategories(clause);
  if (categories) return { category_allowlist: categories };

  const pct = pctIn(clause);
  if (DISCOUNT_RE.test(clause)) {
    const value = pct ?? clause.match(/\b(?:max(?:imum)?\s+)?discount\s*(?:max(?:imum)?|limit)?\s*(\d{1,3})\b/)?.[1];
    const n = value !== undefined ? Number(value) : null;
    if (n !== null && n >= 0 && n <= 100) return { max_discount_pct: n };
  }
  if (FLOOR_RE.test(clause) && pct !== null) return { price_floor_pct: pct };
  const floorPlain = clause.match(/\b(?:price\s+floor|floor|minimum\s+price|min\s+price)\s*(?:pct|percent)?\s*(\d{1,3})\b/);
  if (floorPlain) {
    const n = Number(floorPlain[1]);
    if (n >= 0 && n <= 100) return { price_floor_pct: n };
  }

  const amount = largestPlainNumber(clause);
  if (MAX_ORDER_RE.test(clause) && amount !== null && amount >= 100) {
    return { max_order_value_paise: rupeesToPaise(amount) };
  }
  if (GATE_RE.test(clause) && amount !== null && amount >= 100) {
    return { gate_above_paise: rupeesToPaise(amount) };
  }
  if (QTY_RE.test(clause)) {
    const qty = parseQty(clause);
    if (qty !== null) return { max_qty_per_order: qty };
  }
  return {};
}

const CATEGORY_LEAD_RE = /\b(sirf|only|just|keval|bas)\b/;

/**
 * One clause per rule. "aur"/"and" separate clauses, except inside a category list
 * ("sirf handloom aur gifts"), which is glued back together.
 */
function splitClauses(normalised: string): string[] {
  const fragments = normalised
    .split(/\s*(?:,|;|\.(?=\s|$)|\baur\b|\band\b|\bphir\b|\balso\b)\s*/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const clauses: string[] = [];
  for (const fragment of fragments) {
    const prev = clauses[clauses.length - 1];
    const continuesList = prev !== undefined && CATEGORY_LEAD_RE.test(prev) && !/\d/.test(fragment) && !REFUND_NO_RE.test(fragment);
    if (continuesList) clauses[clauses.length - 1] = `${prev} aur ${fragment}`;
    else clauses.push(fragment);
  }
  return clauses;
}

/** Deterministic Hinglish/English parser; returns only fields it is sure about. */
export function rulesPolicyPatch(text: string): PolicyPatch {
  const clauses = splitClauses(normaliseUtterance(text));
  const patch: PolicyPatch = {};
  for (const clause of clauses) {
    const part = parseClause(clause);
    for (const key of Object.keys(part) as Array<keyof PolicyPatch>) {
      if (!(key in patch)) Object.assign(patch, { [key]: part[key] });
    }
  }
  const parsed = PolicyPatchSchema.safeParse(patch);
  return parsed.success ? parsed.data : {};
}

export function spokenConfirmation(patch: PolicyPatch): string {
  const parts: string[] = [];
  if (patch.price_floor_pct !== undefined) parts.push(`minimum price ${patch.price_floor_pct}% set kar diya`);
  if (patch.max_discount_pct !== undefined) parts.push(`max discount ${patch.max_discount_pct}% set kar diya`);
  if (patch.max_qty_per_order !== undefined) parts.push(`ek order mein max ${patch.max_qty_per_order} set kar diya`);
  if (patch.gate_above_paise !== undefined) parts.push(`${formatINR(patch.gate_above_paise)} se upar aapki manzoori lagegi`);
  if (patch.max_order_value_paise !== undefined) parts.push(`max order ${formatINR(patch.max_order_value_paise)} set kar diya`);
  if (patch.category_allowlist !== undefined) parts.push(`sirf ${patch.category_allowlist.join(" aur ")} bikenge`);
  if (patch.refund_policy !== undefined) parts.push(`return policy set kar di: ${patch.refund_policy}`);
  if (parts.length === 0) return NOT_UNDERSTOOD;
  return `Theek hai — ${parts.join(", ")}.`;
}

/** The spec's voice-patch prompt, verbatim, as the system message. */
export function voicePatchPrompt(text: string): string {
  return `Map this Hindi/Hinglish merchant utterance to a JSON Patch against Policy. Only fields that were clearly stated. Utterance: ${text}`;
}

const VOICE_PATCH_FIELDS = `Policy fields (all optional): price_floor_pct (0-100), max_discount_pct (0-100), max_qty_per_order (integer), max_order_value_paise (integer paise; ₹1 = 100 paise), category_allowlist (lowercase strings), gate_above_paise (integer paise), refund_policy (string).
Reply with a JSON object containing only the fields the utterance clearly sets, e.g. {"price_floor_pct":85}. Reply {} when nothing is clear.`;

const PatchOps = z.array(z.object({ path: z.string(), value: z.unknown() }));

function opsToRecord(ops: z.infer<typeof PatchOps>): Record<string, unknown> {
  return Object.fromEntries(ops.map((op) => [op.path.replace(/^\/+/, ""), op.value]));
}

/** Accepts a flat object, `{patch}`, `{ops}` or RFC 6902 ops — models pick any of them. */
const LlmPatchEnvelope = z.union([
  z.object({ patch: PatchOps }).transform((v) => opsToRecord(v.patch)),
  z.object({ patch: z.record(z.unknown()) }).transform((v) => v.patch),
  z.object({ ops: PatchOps }).transform((v) => opsToRecord(v.ops)),
  PatchOps.transform(opsToRecord),
  z.record(z.unknown()),
]);

function definedFields(patch: PolicyPatch): PolicyPatch {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as PolicyPatch;
}

async function modelPolicyPatch(text: string): Promise<PolicyPatch | null> {
  const raw = await chatJson({
    model: "light",
    system: voicePatchPrompt(text),
    messages: [{ role: "user", content: VOICE_PATCH_FIELDS }],
    temperature: 0,
    schema: LlmPatchEnvelope,
  });
  if (!raw) return null;
  const parsed = PolicyPatchSchema.safeParse(raw);
  return parsed.success ? definedFields(parsed.data) : null;
}

/** Voice policy edit: rules first, model only when the rules found nothing. Never throws. */
export async function utteranceToPolicyPatch(text: string): Promise<UtterancePatch> {
  const fromRules = rulesPolicyPatch(text);
  if (Object.keys(fromRules).length > 0) {
    return { patch: fromRules, spoken_confirmation: spokenConfirmation(fromRules), source: "rules" };
  }
  if (llmMode() === "openai" && text.trim().length > 0) {
    const fromModel = await modelPolicyPatch(text.trim());
    if (fromModel && Object.keys(fromModel).length > 0) {
      return { patch: fromModel, spoken_confirmation: spokenConfirmation(fromModel), source: "llm" };
    }
  }
  return { patch: {}, spoken_confirmation: NOT_UNDERSTOOD, source: "rules" };
}
