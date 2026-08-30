import { SkuSchema, type Sku } from "./schemas";
import { rupeesToPaise } from "./money";

/**
 * Deterministic emoji picker so seeding and offline onboarding never need a model.
 * The LLM onboarding path can override with a better fit.
 */
const EMOJI_BY_KEYWORD: Array<[RegExp, string]> = [
  [/saree|sari/i, "🥻"],
  [/blouse/i, "👚"],
  [/dupatta|stole|scarf/i, "🧣"],
  [/diya|lamp|candle/i, "🪔"],
  [/jutti|shoe|footwear|sandal/i, "👡"],
  [/kurta|shirt/i, "👕"],
  [/bag|tote/i, "👜"],
  [/jewel|earring|necklace|bangle/i, "💍"],
  [/tea|chai/i, "🍵"],
  [/sweet|mithai|laddoo/i, "🍬"],
  [/box|gift/i, "🎁"],
];

export function pickEmoji(name: string, tags: string[] = [], category = ""): string {
  const haystack = `${name} ${tags.join(" ")} ${category}`;
  for (const [re, emoji] of EMOJI_BY_KEYWORD) {
    if (re.test(haystack)) return emoji;
  }
  return "🛍️";
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields with commas). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

function pickField(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== "") return row[c];
  }
  return "";
}

/**
 * Turn loosely-formatted merchant CSV rows into validated SKUs.
 * Tolerates columns like "price", "price_inr", "mrp", "qty", "stock", "tags".
 */
export function skusFromCsv(text: string): Sku[] {
  const rows = parseCsv(text);
  const seen = new Set<string>();
  const skus: Sku[] = [];

  for (const row of rows) {
    const name = pickField(row, ["name", "product", "title", "item"]);
    if (!name) continue;
    const priceRaw = pickField(row, ["price_inr", "price", "mrp", "rate", "amount"]);
    const priceMatch = priceRaw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (!priceMatch) continue;
    const price = Number(priceMatch[0]);
    const stockRaw = pickField(row, ["stock", "qty", "quantity", "inventory"]);
    const stock = Number.parseInt(stockRaw.replace(/[^\d]/g, ""), 10);
    const category = (pickField(row, ["category", "type", "collection"]) || "general").toLowerCase();
    const tags = pickField(row, ["tags", "keywords"])
      .split(/[,|;]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const description = pickField(row, ["description", "desc", "details"]);

    let id = `sku_${slugify(name)}`;
    let n = 2;
    while (seen.has(id)) {
      id = `sku_${slugify(name)}-${n}`;
      n += 1;
    }
    seen.add(id);

    const parsed = SkuSchema.safeParse({
      id,
      name,
      description,
      price_paise: rupeesToPaise(price),
      stock: Number.isFinite(stock) ? stock : 0,
      tags,
      category,
      image_emoji: pickEmoji(name, tags, category),
    });
    if (parsed.success) skus.push(parsed.data);
  }
  return skus;
}
