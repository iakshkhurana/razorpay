import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";
process.env.AGENTGATE_EMBEDDINGS = "off";

import { skusFromCsv } from "./catalog";
import { clearAllTables, decrementStock, replaceCatalog } from "./db";
import { cosine, findBundleAddon, indexCatalog, keywordScore, searchCatalog, searchMode } from "./search";
import type { Sku } from "./schemas";

const model = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock("@xenova/transformers", () => ({ env: {}, pipeline: model.pipeline }));

const seedCsv = fs.readFileSync(path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv"), "utf8");
const catalog: Sku[] = skusFromCsv(seedCsv);
const byName = (name: string): Sku => {
  const sku = catalog.find((s) => s.name === name);
  if (!sku) throw new Error(`missing seed SKU ${name}`);
  return sku;
};

describe("searchCatalog (keyword mode)", () => {
  beforeAll(async () => {
    await indexCatalog(catalog);
  });

  it("reports keyword mode when embeddings are off", () => {
    expect(searchMode()).toBe("keyword");
  });

  it("puts the cotton saree first for 'anniversary gift for mom', with or without a ₹2,000 cap", async () => {
    const open = await searchCatalog("anniversary gift for mom", 5);
    expect(open[0].sku.name).toBe("Cotton Handloom Saree");
    expect(open.every((h) => h.mode === "keyword")).toBe(true);

    const capped = await searchCatalog("anniversary gift for mom", 5, { maxPricePaise: 200_000 });
    expect(capped[0].sku.name).toBe("Cotton Handloom Saree");
    expect(capped.every((h) => h.sku.price_paise <= 200_000)).toBe(true);
  });

  it("puts Banarasi Silk Saree first for 'banarasi'", async () => {
    const hits = await searchCatalog("banarasi");
    expect(hits[0].sku.name).toBe("Banarasi Silk Saree");
  });

  it("puts Punjabi Jutti Gold first for 'jutti'", async () => {
    const hits = await searchCatalog("jutti");
    expect(hits[0].sku.name).toBe("Punjabi Jutti Gold");
  });

  it("maps 'kuch achha sa gift' to gift-tagged items only", async () => {
    const hits = await searchCatalog("kuch achha sa gift");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.sku.tags.includes("gift"))).toBe(true);
  });

  it("understands Hinglish synonyms: 'maa ke liye tohfa' reaches the cotton saree", async () => {
    const hits = await searchCatalog("maa ke liye tohfa");
    expect(hits[0].sku.name).toBe("Cotton Handloom Saree");
  });

  it("puts Matching Blouse Piece first for 'blouse'", async () => {
    const hits = await searchCatalog("blouse");
    expect(hits[0].sku.name).toBe("Matching Blouse Piece");
  });

  it("returns nothing for a query that matches no SKU", async () => {
    expect(await searchCatalog("phone charger")).toEqual([]);
    expect(await searchCatalog("   ")).toEqual([]);
    expect(await searchCatalog("saree", 0)).toEqual([]);
  });

  it("breaks score ties by lower price", async () => {
    const hits = await searchCatalog("saree");
    const sarees = hits.filter((h) => h.sku.tags.includes("saree"));
    expect(sarees[0].sku.name).toBe("Cotton Handloom Saree");
    for (let i = 1; i < sarees.length; i += 1) {
      const prev = sarees[i - 1];
      const cur = sarees[i];
      expect(prev.score > cur.score || (prev.score === cur.score && prev.sku.price_paise <= cur.sku.price_paise)).toBe(true);
    }
  });

  it("answers in keyword mode well under 100ms", async () => {
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) await searchCatalog("anniversary gift for mom");
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("stock handling", () => {
  const stole = byName("Handwoven Stole");
  const modified = catalog.map((s) => (s.id === stole.id ? { ...s, stock: 0 } : s));

  beforeAll(async () => {
    await indexCatalog(modified);
  });

  it("keeps only SKUs at or under maxPricePaise", async () => {
    const hits = await searchCatalog("saree", 8, { maxPricePaise: 200_000 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.sku.price_paise <= 200_000)).toBe(true);
    expect(hits[0].sku.name).toBe("Cotton Handloom Saree");
  });

  it("drops out-of-stock SKUs with inStockOnly and ranks them last otherwise", async () => {
    const strict = await searchCatalog("stole", 5, { inStockOnly: true });
    expect(strict.map((h) => h.sku.id)).not.toContain(stole.id);

    const loose = await searchCatalog("gift", 8);
    expect(loose.map((h) => h.sku.id)).toContain(stole.id);
    expect(loose[loose.length - 1].sku.id).toBe(stole.id);
  });
});

describe("catalog source", () => {
  afterAll(() => {
    clearAllTables();
  });

  it("searches the persisted catalog and sees stock changes without re-indexing", async () => {
    clearAllTables();
    replaceCatalog(catalog);
    const blouse = byName("Matching Blouse Piece");

    const before = await searchCatalog("blouse", 1, { inStockOnly: true });
    expect(before[0]?.sku.id).toBe(blouse.id);

    decrementStock(blouse.id, blouse.stock);
    expect(await searchCatalog("blouse", 1, { inStockOnly: true })).toEqual([]);
    const loose = await searchCatalog("blouse", 1);
    expect(loose[0]?.sku.stock).toBe(0);
  });

  it("lets the persisted catalog supersede an explicitly indexed list", async () => {
    clearAllTables();
    await indexCatalog(catalog.filter((s) => s.name !== "Punjabi Jutti Gold"));
    expect(await searchCatalog("jutti")).toEqual([]);

    replaceCatalog(catalog);
    const hits = await searchCatalog("jutti");
    expect(hits[0]?.sku.name).toBe("Punjabi Jutti Gold");
  });
});

describe("keywordScore", () => {
  it("scores each term by its strongest field and adds terms up", () => {
    const blouse = byName("Matching Blouse Piece");
    const saree = byName("Cotton Handloom Saree");
    const diya = byName("Brass Diya Gift Set");
    expect(keywordScore("blouse", blouse)).toBe(3);
    expect(keywordScore("blouse", saree)).toBe(0);
    expect(keywordScore("saree", saree)).toBe(3);
    expect(keywordScore("gift", saree)).toBe(2);
    expect(keywordScore("gift", diya)).toBe(3);
    expect(keywordScore("cotton saree", saree)).toBe(6);
    expect(keywordScore("daily saree", saree)).toBe(5);
    expect(keywordScore("", saree)).toBe(0);
    expect(keywordScore("for the 2000", saree)).toBe(0);
  });
});

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    const a = new Float32Array([0.3, 0.4, 0.5]);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("findBundleAddon", () => {
  it("pairs a saree with the blouse piece", () => {
    const addon = findBundleAddon(byName("Cotton Handloom Saree"), catalog);
    expect(addon?.name).toBe("Matching Blouse Piece");
  });

  it("pairs the diya set with a different cheap gift, deterministically", () => {
    const diya = byName("Brass Diya Gift Set");
    const first = findBundleAddon(diya, catalog);
    const second = findBundleAddon(diya, catalog);
    expect(first?.id).toBe(second?.id);
    if (first) {
      expect(first.id).not.toBe(diya.id);
      expect(first.tags).toContain("gift");
      expect(first.price_paise).toBeLessThan(70_000);
    }
  });

  it("returns null when the addon is out of stock or the anchor has no partner", () => {
    const noBlouse = catalog.map((s) => (s.name === "Matching Blouse Piece" ? { ...s, stock: 0 } : s));
    expect(findBundleAddon(byName("Cotton Handloom Saree"), noBlouse)).toBeNull();
    expect(findBundleAddon(byName("Punjabi Jutti Gold"), catalog)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Embedding mode against a stubbed model                             */
/* ------------------------------------------------------------------ */

/** One dimension per concept; "candle" shares the diya dimension so the stub has a purely semantic link. */
const DIMS: string[][] = [
  ["saree", "sarees"],
  ["gift", "gifts"],
  ["blouse"],
  ["diya", "diyas", "candle"],
  ["stole"],
  ["dupatta"],
  ["jutti"],
  ["silk"],
  ["cotton"],
  ["brass"],
];

function stubVector(text: string): Float32Array {
  const words = new Set(text.toLowerCase().split(/[^a-z]+/));
  const v = Float32Array.from(DIMS, (dim) => (dim.some((w) => words.has(w)) ? 1 : 0));
  let norm = 0;
  for (const x of v) norm += x * x;
  return norm === 0 ? v : v.map((x) => x / Math.sqrt(norm));
}

function stubExtractor(embedded: string[], failOn: (text: string) => boolean = () => false) {
  return async (texts: string[]) => {
    for (const t of texts) if (failOn(t)) throw new Error("onnx session failed");
    embedded.push(...texts);
    const data = new Float32Array(texts.length * DIMS.length);
    texts.forEach((t, i) => data.set(stubVector(t), i * DIMS.length));
    return { dims: [texts.length, DIMS.length], data };
  };
}

describe("embedding mode (stubbed model)", () => {
  async function freshSearch(): Promise<typeof import("./search")> {
    vi.resetModules();
    return import("./search");
  }

  beforeEach(() => {
    process.env.AGENTGATE_EMBEDDINGS = "";
    model.pipeline.mockReset();
  });

  afterAll(() => {
    process.env.AGENTGATE_EMBEDDINGS = "off";
  });

  it("never imports the model while AGENTGATE_EMBEDDINGS=off", async () => {
    process.env.AGENTGATE_EMBEDDINGS = "off";
    const s = await freshSearch();
    await s.indexCatalog(catalog);
    expect(model.pipeline).not.toHaveBeenCalled();
    expect(s.embedderStatus()).toBe("idle");
    expect(s.searchMode()).toBe("keyword");
  });

  it("indexes with the model, ranks by keyword tier plus cosine, and keeps the cosine floor", async () => {
    const embedded: string[] = [];
    model.pipeline.mockResolvedValue(stubExtractor(embedded));
    const s = await freshSearch();

    await s.indexCatalog(catalog);
    expect(model.pipeline).toHaveBeenCalledWith("feature-extraction", s.EMBEDDING_MODEL, expect.objectContaining({ quantized: true }));
    expect(s.searchMode()).toBe("embedding");
    expect(embedded).toHaveLength(catalog.length);

    const hits = await s.searchCatalog("anniversary gift for mom", 5, { maxPricePaise: 200_000 });
    expect(hits[0].sku.name).toBe("Cotton Handloom Saree");
    expect(hits.every((h) => h.mode === "embedding")).toBe(true);
    expect(hits.every((h) => h.score >= 1)).toBe(true);

    const semantic = await s.searchCatalog("candle");
    expect(semantic.map((h) => h.sku.name)).toEqual(["Brass Diya Gift Set"]);
    expect(await s.searchCatalog("phone charger")).toEqual([]);
  });

  it("re-embeds only SKUs whose text changed, never on price or stock edits", async () => {
    const embedded: string[] = [];
    model.pipeline.mockResolvedValue(stubExtractor(embedded));
    const s = await freshSearch();

    await s.indexCatalog(catalog);
    await s.indexCatalog(catalog);
    await s.indexCatalog(catalog.map((sku) => ({ ...sku, stock: sku.stock - 1, price_paise: sku.price_paise + 100 })));
    expect(embedded).toHaveLength(catalog.length);

    await s.searchCatalog("saree");
    await s.searchCatalog("saree");
    expect(embedded).toHaveLength(catalog.length + 1);

    const edited = catalog.map((sku) => (sku.name === "Handwoven Stole" ? { ...sku, description: "Now in six colours" } : sku));
    await s.indexCatalog(edited);
    expect(embedded).toHaveLength(catalog.length + 2);
    expect(embedded[embedded.length - 1]).toContain("Now in six colours");
  });

  it("settles for keyword mode when the model cannot load, without throwing or retrying", async () => {
    model.pipeline.mockRejectedValue(new Error("getaddrinfo ENOTFOUND huggingface.co"));
    const s = await freshSearch();

    await expect(s.warmSearch()).resolves.toBe("keyword");
    expect(s.embedderStatus()).toBe("unavailable");

    await s.indexCatalog(catalog);
    const hits = await s.searchCatalog("banarasi");
    expect(hits[0].sku.name).toBe("Banarasi Silk Saree");
    expect(hits[0].mode).toBe("keyword");
    expect(model.pipeline).toHaveBeenCalledTimes(1);
  });

  it("time-boxes the first load, never blocks later searches on it, and adopts the model once it arrives", async () => {
    let modelArrives: (extractor: unknown) => void = () => undefined;
    model.pipeline.mockReturnValue(new Promise((resolve) => { modelArrives = resolve; }));
    const s = await freshSearch();

    await s.indexCatalog(catalog, { loadTimeoutMs: 10 });
    expect(s.searchMode()).toBe("keyword");
    expect(s.embedderStatus()).toBe("loading");

    const meanwhile = await s.searchCatalog("banarasi");
    expect(meanwhile[0].mode).toBe("keyword");

    modelArrives(stubExtractor([]));
    await vi.waitFor(() => expect(s.embedderStatus()).toBe("ready"));
    const after = await s.searchCatalog("banarasi");
    expect(after[0].sku.name).toBe("Banarasi Silk Saree");
    expect(after[0].mode).toBe("embedding");
    expect(model.pipeline).toHaveBeenCalledTimes(1);
  });

  it("marks the model unavailable when embedding the catalog fails and serves keyword hits", async () => {
    model.pipeline.mockResolvedValue(stubExtractor([], (t) => t.startsWith("Banarasi")));
    const s = await freshSearch();

    await s.indexCatalog(catalog);
    expect(s.searchMode()).toBe("keyword");
    expect(s.embedderStatus()).toBe("unavailable");
    const hits = await s.searchCatalog("banarasi");
    expect(hits[0].sku.name).toBe("Banarasi Silk Saree");
    expect(hits[0].mode).toBe("keyword");
  });

  it("falls back to keyword hits when embedding the query fails", async () => {
    model.pipeline.mockResolvedValue(stubExtractor([], (t) => t === "banarasi"));
    const s = await freshSearch();

    await s.indexCatalog(catalog);
    expect(s.searchMode()).toBe("embedding");
    const hits = await s.searchCatalog("banarasi");
    expect(hits[0].sku.name).toBe("Banarasi Silk Saree");
    expect(hits[0].mode).toBe("keyword");
    expect(s.embedderStatus()).toBe("unavailable");
    expect(s.searchMode()).toBe("keyword");
  });

  it("rejects a malformed tensor from the model instead of trusting it", async () => {
    model.pipeline.mockResolvedValue(async () => ({ dims: [1], data: "nope" }));
    const s = await freshSearch();

    await s.indexCatalog(catalog);
    expect(s.searchMode()).toBe("keyword");
    expect(s.embedderStatus()).toBe("unavailable");
  });
});
