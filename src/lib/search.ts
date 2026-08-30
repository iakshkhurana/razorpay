import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { listSkus } from "./db";
import type { Sku } from "./schemas";

/**
 * Catalog search: local MiniLM embeddings with in-memory cosine when the model
 * is available, weighted keyword scoring otherwise. Nothing here ever throws
 * because the model is missing or the network is down — the mode just degrades.
 */

export type SearchMode = "embedding" | "keyword";
export type SearchHit = { sku: Sku; score: number; mode: SearchMode };

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
/**
 * Request-path budget for the first model load. A cached model loads in well
 * under a second; a cold download is left running in the background and
 * adopted by the next search rather than stalling a buyer's turn.
 */
export const MODEL_LOAD_TIMEOUT_MS = 8_000;

export interface IndexOptions {
  /** How long to wait for the model before this call settles for keyword mode. */
  loadTimeoutMs?: number;
}

export interface SearchOptions {
  inStockOnly?: boolean;
  /** Drop SKUs whose list price is above this (e.g. the buyer's spend cap). */
  maxPricePaise?: number;
}

const EMBED_BATCH = 16;
const QUERY_CACHE_MAX = 256;

/** Embedding-mode hits with no keyword match need at least this cosine to count as related. */
const MIN_COSINE = 0.15;
/** Scores closer than this are a tie, and the cheaper SKU wins. */
const SCORE_TIE_EPS = 0.05;

/* ------------------------------------------------------------------ */
/*  Vectors                                                            */
/* ------------------------------------------------------------------ */

type Vector = Float32Array | number[];

export function cosine(a: Vector, b: Vector): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(na * nb)));
}

/* ------------------------------------------------------------------ */
/*  Tokenisation & keyword scoring                                     */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "for", "to", "with", "under", "at", "by", "from",
  "my", "me", "i", "we", "you", "our", "some", "any", "want", "need", "looking", "show", "find", "buy",
  "budget", "price", "rs", "inr", "rupees", "rupee", "around", "about", "please",
  "ka", "ki", "ke", "ko", "se", "sa", "si", "mein", "liye", "chahiye", "hai", "hain", "ho", "kuch",
  "aur", "ya", "bhi", "ek", "koi", "dikhao", "dikhaiye", "batao", "mujhe", "hum", "humein", "wala", "wali",
]);

const PHRASE_SYNONYMS: Array<[RegExp, string[]]> = [
  [/\bkuch\s+(?:bhi\s+)?ac+h+a\b/, ["gift"]],
  [/\bac+h+a\s+sa\b/, ["gift"]],
  [/\bsomething\s+(?:nice|special|good)\b/, ["gift"]],
];

const TOKEN_SYNONYMS: Record<string, string[]> = {
  gift: ["gift"],
  present: ["gift"],
  tohfa: ["gift"],
  uphaar: ["gift"],
  uphar: ["gift"],
  gifting: ["gift"],
  anniversary: ["gift"],
  birthday: ["gift"],
  janamdin: ["gift"],
  mom: ["gift", "saree"],
  mother: ["gift", "saree"],
  maa: ["gift", "saree"],
  mummy: ["gift", "saree"],
  mata: ["gift", "saree"],
  amma: ["gift", "saree"],
  wife: ["gift", "saree"],
  patni: ["gift", "saree"],
  biwi: ["gift", "saree"],
  bhabhi: ["gift", "saree"],
  nani: ["gift", "saree"],
  dadi: ["gift", "saree"],
  sister: ["gift"],
  behen: ["gift"],
  didi: ["gift"],
  friend: ["gift"],
  dost: ["gift"],
  sari: ["saree"],
  wedding: ["wedding"],
  shaadi: ["wedding"],
  shadi: ["wedding"],
  vivah: ["wedding"],
  marriage: ["wedding"],
  bridal: ["wedding"],
  diwali: ["festive"],
  deepavali: ["festive"],
  festive: ["festive"],
  festival: ["festive"],
  tyohar: ["festive"],
  pooja: ["festive", "diya"],
  puja: ["festive", "diya"],
  chunni: ["dupatta"],
  chunari: ["dupatta"],
  shawl: ["stole"],
  scarf: ["stole"],
  juti: ["jutti"],
  mojari: ["jutti"],
  shoe: ["jutti", "footwear"],
  lamp: ["diya"],
  diye: ["diya"],
  resham: ["silk"],
  everyday: ["daily"],
  casual: ["daily"],
  office: ["daily"],
  sardi: ["winter"],
};

function stem(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((t) => t.length > 0 && !/^\d+$/.test(t))
    .map(stem);
}

/** Query terms after stopword removal, stemming and Hinglish synonym expansion. */
export function queryTerms(query: string): Set<string> {
  const lower = query.toLowerCase();
  const out = new Set<string>();
  for (const [re, adds] of PHRASE_SYNONYMS) {
    if (re.test(lower)) for (const a of adds) out.add(a);
  }
  for (const raw of tokens(lower)) {
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
    for (const syn of TOKEN_SYNONYMS[raw] ?? []) out.add(syn);
  }
  return out;
}

function matches(field: Set<string>, term: string): boolean {
  if (field.has(term)) return true;
  if (term.length < 4) return false;
  for (const f of field) if (f.startsWith(term)) return true;
  return false;
}

const FIELD_WEIGHTS = { name: 3, tags: 2, category: 2, description: 1 } as const;

/**
 * Each query term scores the strongest field it matches (name 3, tags 2,
 * category 2, description 1). Fields are not summed per term, so an item that
 * repeats one word everywhere ("Gift Set", tag gift, category gifts) cannot
 * outrank a better multi-term match.
 */
export function keywordScore(query: string, sku: Sku): number {
  const terms = queryTerms(query);
  if (terms.size === 0) return 0;
  const fields = {
    name: new Set(tokens(sku.name)),
    tags: new Set(sku.tags.flatMap(tokens)),
    category: new Set(tokens(sku.category)),
    description: new Set(tokens(sku.description)),
  };
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const key of Object.keys(FIELD_WEIGHTS) as Array<keyof typeof FIELD_WEIGHTS>) {
      if (matches(fields[key], term)) best = Math.max(best, FIELD_WEIGHTS[key]);
    }
    score += best;
  }
  return score;
}

/* ------------------------------------------------------------------ */
/*  Embedder (lazy, time-boxed, never throws)                          */
/* ------------------------------------------------------------------ */

type Embedder = (texts: string[]) => Promise<Float32Array[]>;

type EmbedderState =
  | { status: "idle" }
  | { status: "loading"; attempt: Promise<Embedder | null> }
  | { status: "ready"; embed: Embedder }
  | { status: "unavailable"; reason: string };

let embedderState: EmbedderState = { status: "idle" };

function embeddingsDisabled(): boolean {
  return (process.env.AGENTGATE_EMBEDDINGS ?? "").toLowerCase() === "off";
}

function markUnavailable(err: unknown): void {
  embedderState = { status: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  queryCache.clear();
  if (mode === "embedding") mode = "keyword";
}

/** The model's output is an untyped tensor; only a 2-D [rows, dim] numeric block is accepted. */
const PooledTensorSchema = z.object({
  dims: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  data: z.custom<ArrayLike<number | bigint>>(
    (v) => typeof v === "object" && v !== null && typeof (v as { length?: unknown }).length === "number",
  ),
});

function tensorRows(output: unknown, expectedRows: number): Float32Array[] {
  const tensor = PooledTensorSchema.parse(output);
  const [rows, dim] = tensor.dims;
  if (rows !== expectedRows || tensor.data.length < rows * dim) {
    throw new Error(`embedding tensor is ${rows}x${dim}, expected ${expectedRows} rows`);
  }
  const out: Float32Array[] = [];
  for (let r = 0; r < rows; r += 1) {
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i += 1) v[i] = Number(tensor.data[r * dim + i]);
    out.push(v);
  }
  return out;
}

async function createEmbedder(): Promise<Embedder> {
  const { env, pipeline } = await import("@xenova/transformers");
  env.cacheDir = path.join(process.cwd(), ".cache", "transformers");
  env.allowLocalModels = true;
  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL, { quantized: true });
  return async (texts) => {
    const vectors: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const output: unknown = await extractor(batch, { pooling: "mean", normalize: true });
      vectors.push(...tensorRows(output, batch.length));
    }
    return vectors;
  };
}

function startLoading(): Promise<Embedder | null> {
  const attempt = createEmbedder().then(
    (embed) => {
      embedderState = { status: "ready", embed };
      return embed;
    },
    (err: unknown) => {
      markUnavailable(err);
      return null;
    },
  );
  embedderState = { status: "loading", attempt };
  return attempt;
}

/**
 * Resolves the embedder or null within `timeoutMs`. The first call starts
 * loading; a load that outlives the time-box resolves null now but keeps
 * running and is adopted by later calls once it finishes. A zero budget only
 * reports what is already loaded.
 */
function getEmbedder(timeoutMs: number): Promise<Embedder | null> {
  if (embeddingsDisabled()) return Promise.resolve(null);
  if (embedderState.status === "ready") return Promise.resolve(embedderState.embed);
  if (embedderState.status === "unavailable") return Promise.resolve(null);

  const attempt = embedderState.status === "loading" ? embedderState.attempt : startLoading();
  if (timeoutMs <= 0) return Promise.resolve(null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  void attempt.finally(() => clearTimeout(timer));
  return Promise.race([attempt, timeout]);
}

export function embedderStatus(): EmbedderState["status"] {
  return embedderState.status;
}

/* ------------------------------------------------------------------ */
/*  Index                                                              */
/* ------------------------------------------------------------------ */

interface IndexEntry {
  sku: Sku;
  hash: string;
  vector: Float32Array | null;
}

let index: IndexEntry[] = [];
let mode: SearchMode | "uninitialised" = "uninitialised";
const vectorCache = new Map<string, { hash: string; vector: Float32Array }>();
const queryCache = new Map<string, Float32Array>();

export function embeddingText(sku: Sku): string {
  return [sku.name, sku.description, sku.tags.join(", "), sku.category].filter(Boolean).join(". ");
}

function contentHash(sku: Sku): string {
  return createHash("sha256").update(embeddingText(sku)).digest("hex").slice(0, 16);
}

export function searchMode(): SearchMode | "uninitialised" {
  return mode;
}

async function buildIndex(items: Sku[], loadTimeoutMs: number): Promise<void> {
  const entries: IndexEntry[] = items.map((sku) => {
    const hash = contentHash(sku);
    const cached = vectorCache.get(sku.id);
    return { sku, hash, vector: cached && cached.hash === hash ? cached.vector : null };
  });

  const embed = await getEmbedder(loadTimeoutMs);
  const pending = entries.filter((e) => e.vector === null);
  if (embed && pending.length > 0) {
    try {
      const vectors = await embed(pending.map((e) => embeddingText(e.sku)));
      pending.forEach((e, i) => {
        const vector = vectors[i];
        if (!vector) return;
        e.vector = vector;
        vectorCache.set(e.sku.id, { hash: e.hash, vector });
      });
    } catch (err) {
      markUnavailable(err);
    }
  }

  index = entries;
  mode = embedderState.status === "ready" && entries.every((e) => e.vector !== null) ? "embedding" : "keyword";
  if (mode === "keyword") queryCache.clear();
}

/**
 * Builds the in-memory index from the persisted catalog, or from `skus` when
 * given. Vectors are cached per SKU id by content hash, so re-indexing an
 * unchanged catalog costs no model calls; price and stock edits never
 * re-embed. Without a model the index still builds and search runs in keyword
 * mode.
 */
export async function indexCatalog(skus?: Sku[], opts: IndexOptions = {}): Promise<void> {
  await buildIndex(skus ?? listSkus(), opts.loadTimeoutMs ?? MODEL_LOAD_TIMEOUT_MS);
}

/** Loads the model within the budget and reports which mode search will run in. Never rejects. */
export async function warmSearch(opts: IndexOptions = {}): Promise<SearchMode> {
  await indexCatalog(undefined, opts);
  return mode === "embedding" ? "embedding" : "keyword";
}

/**
 * The persisted catalog is the live one, so stock and price changes are seen
 * on the next search. An explicitly indexed list only stands in while the DB
 * holds no catalog.
 */
function liveCatalog(): Sku[] {
  const persisted = listSkus();
  return persisted.length > 0 ? persisted : index.map((e) => e.sku);
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

/** In-stock first, then score (near-equal scores tie), then lower price. */
function rank(hits: SearchHit[]): SearchHit[] {
  const tier = (h: SearchHit) => Math.round(h.score / SCORE_TIE_EPS);
  return hits.sort((a, b) => {
    const stockA = a.sku.stock > 0 ? 1 : 0;
    const stockB = b.sku.stock > 0 ? 1 : 0;
    if (stockA !== stockB) return stockB - stockA;
    const tierA = tier(a);
    const tierB = tier(b);
    if (tierA !== tierB) return tierB - tierA;
    return a.sku.price_paise - b.sku.price_paise;
  });
}

async function embedQuery(query: string, embed: Embedder): Promise<Float32Array> {
  const key = query.trim().toLowerCase();
  const cached = queryCache.get(key);
  if (cached) return cached;
  const [vector] = await embed([key]);
  if (queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(key, vector);
  return vector;
}

function keywordHits(query: string, entries: IndexEntry[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const e of entries) {
    const score = keywordScore(query, e.sku);
    if (score > 0) hits.push({ sku: e.sku, score, mode: "keyword" });
  }
  return hits;
}

/**
 * Score = keyword score + cosine. The keyword tier carries the Hinglish and
 * relation priors the model never learned (tohfa, maa → saree) and cosine
 * refines within a tier; with no keyword match the hit stands on cosine alone.
 * Returns null when the model cannot answer, so the caller falls back.
 */
async function embeddingHits(query: string, entries: IndexEntry[]): Promise<SearchHit[] | null> {
  if (embedderState.status !== "ready") return null;
  let qv: Float32Array;
  try {
    qv = await embedQuery(query, embedderState.embed);
  } catch (err) {
    markUnavailable(err);
    return null;
  }
  const hits: SearchHit[] = [];
  for (const e of entries) {
    const sim = e.vector ? cosine(qv, e.vector) : 0;
    const kw = keywordScore(query, e.sku);
    if (kw === 0 && sim < MIN_COSINE) continue;
    hits.push({ sku: e.sku, score: Math.round((kw + sim) * 1e4) / 1e4, mode: "embedding" });
  }
  return hits;
}

/**
 * Top-k catalog hits. Out-of-stock SKUs rank after in-stock ones and are dropped
 * entirely with `inStockOnly`. Unrelated queries yield an empty list rather than
 * noise: keyword mode needs a positive score, embedding mode a related cosine.
 * Only the very first search waits for the model; later searches never block
 * on a load still in flight.
 */
export async function searchCatalog(query: string, k = 5, opts: SearchOptions = {}): Promise<SearchHit[]> {
  if (k <= 0 || query.trim().length === 0) return [];
  await buildIndex(liveCatalog(), mode === "uninitialised" ? MODEL_LOAD_TIMEOUT_MS : 0);

  const entries = index.filter(
    (e) =>
      (!opts.inStockOnly || e.sku.stock > 0) &&
      (opts.maxPricePaise === undefined || e.sku.price_paise <= opts.maxPricePaise),
  );
  const hits = (mode === "embedding" ? await embeddingHits(query, entries) : null) ?? keywordHits(query, entries);
  return rank(hits).slice(0, k);
}

/* ------------------------------------------------------------------ */
/*  Bundle partner                                                     */
/* ------------------------------------------------------------------ */

const ADDON_MAX_PAISE = 70_000;

function hasTag(sku: Sku, ...names: string[]): boolean {
  const tags = sku.tags.map((t) => t.toLowerCase());
  return names.some((n) => tags.includes(n));
}

function nameMatches(sku: Sku, re: RegExp): boolean {
  return re.test(sku.name);
}

/**
 * The one deterministic upsell partner for an anchor SKU:
 * saree → the in-stock addon/matching piece (blouse);
 * dupatta, stole or gift → the cheapest other in-stock gift under ₹700;
 * anything else → null.
 */
export function findBundleAddon(anchor: Sku, catalog: Sku[]): Sku | null {
  const others = catalog.filter((s) => s.id !== anchor.id && s.stock > 0);

  if (hasTag(anchor, "saree") || nameMatches(anchor, /saree|sari/i)) {
    const addon = others
      .filter((s) => hasTag(s, "addon", "matching"))
      .sort((a, b) => a.price_paise - b.price_paise || a.id.localeCompare(b.id));
    return addon[0] ?? null;
  }

  const giftLike =
    hasTag(anchor, "dupatta", "stole", "gift") ||
    anchor.category.toLowerCase() === "gifts" ||
    nameMatches(anchor, /dupatta|stole|gift/i);
  if (giftLike) {
    const gifts = others
      .filter((s) => hasTag(s, "gift") && s.price_paise < ADDON_MAX_PAISE)
      .sort((a, b) => a.price_paise - b.price_paise || a.id.localeCompare(b.id));
    return gifts[0] ?? null;
  }

  return null;
}
