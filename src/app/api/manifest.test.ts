import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { skusFromCsv } from "../../lib/catalog";
import { clearAllTables, replaceCatalog, setPolicy, upsertMerchant } from "../../lib/db";
import { DEFAULT_POLICY } from "../../lib/schemas";
import { GET } from "./agent/manifest/route";

/**
 * The manifest is what an AI buyer reads before it spends a turn asking. It must
 * describe the rulebook the engine actually enforces, and it must not hand over
 * the merchant's negotiating position.
 */

const seed = skusFromCsv(fs.readFileSync(path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv"), "utf8"));

beforeEach(() => {
  clearAllTables();
  upsertMerchant({ name: "Ramesh Handlooms", live: true });
  replaceCatalog(seed);
  setPolicy(DEFAULT_POLICY);
});

describe("agent manifest", () => {
  it("publishes the rules an agent needs and withholds the ones it should not have", async () => {
    const body = await (await GET()).json();

    expect(body.protocol).toBe("agentgate/1");
    expect(body.merchant.name).toBe("Ramesh Handlooms");
    expect(body.rules.sellable_categories).toEqual(DEFAULT_POLICY.category_allowlist);
    expect(body.rules.max_items_per_order).toBe(DEFAULT_POLICY.max_qty_per_order);
    expect(body.rules.owner_decides_above_paise).toBe(DEFAULT_POLICY.gate_above_paise);

    // the negotiating position stays inside the engine
    const flat = JSON.stringify(body);
    expect(flat).not.toContain(String(DEFAULT_POLICY.price_floor_pct));
    expect(body.rules.withheld).toContain("price_floor_pct");
    expect(body.rules.withheld).toContain("max_discount_pct");
  });

  it("tracks the live rulebook rather than a hardcoded copy", async () => {
    setPolicy({ ...DEFAULT_POLICY, category_allowlist: ["gifts"], max_qty_per_order: 2 });
    const body = await (await GET()).json();

    expect(body.rules.sellable_categories).toEqual(["gifts"]);
    expect(body.rules.max_items_per_order).toBe(2);
    // 8 seeded products, only the single gifts SKU is sellable under this rulebook
    expect(body.catalog.products).toBe(8);
    expect(body.catalog.sellable_products).toBe(1);
  });

  it("names every verdict an agent can receive", async () => {
    const body = await (await GET()).json();
    expect(body.verdicts.map((v: { decision: string }) => v.decision)).toEqual(["ALLOW", "COUNTER", "GATE", "DENY"]);
    expect(body.guarantees.join(" ")).toContain("No language model");
  });
});
