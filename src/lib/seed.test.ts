import { beforeEach, describe, expect, it } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";

import { clearAllTables, getMerchant, listSkus } from "./db";
import { listEntries } from "./ledger";
import { ensureDemoShop, seedDatabase, seedSkus } from "./seed";

describe("seed", () => {
  beforeEach(() => {
    clearAllTables();
  });

  it("loads the demo shop with the shop-live entry as the first line of the book", () => {
    const { skuCount } = seedDatabase({ quiet: true });
    expect(skuCount).toBe(8);
    expect(getMerchant()?.name).toBe("Ramesh Handlooms");
    expect(getMerchant()?.live).toBe(true);
    expect(listSkus().map((s) => s.category)).toContain("footwear");
    const book = listEntries();
    expect(book).toHaveLength(1);
    expect(book[0].reason_code).toBe("SHOP_LIVE");
  });

  it("ensureDemoShop seeds an empty database once and leaves a live one alone", () => {
    expect(ensureDemoShop()).toBe(true);
    expect(ensureDemoShop()).toBe(false);
    expect(listEntries()).toHaveLength(1);
  });

  it("the embedded catalog matches the CSV on disk", () => {
    const skus = seedSkus();
    expect(skus.map((s) => s.name)).toEqual([
      "Cotton Handloom Saree",
      "Matching Blouse Piece",
      "Phulkari Dupatta",
      "Banarasi Silk Saree",
      "Zari Border Saree",
      "Handwoven Stole",
      "Brass Diya Gift Set",
      "Punjabi Jutti Gold",
    ]);
  });
});
