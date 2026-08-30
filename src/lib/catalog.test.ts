import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, pickEmoji, skusFromCsv, slugify } from "./catalog";

const seedCsv = fs.readFileSync(path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv"), "utf8");

describe("parseCsv", () => {
  it("handles quoted fields containing commas", () => {
    const rows = parseCsv('name,tags\nSaree,"a,b,c"\n');
    expect(rows).toEqual([{ name: "Saree", tags: "a,b,c" }]);
  });

  it("skips blank lines and trims whitespace", () => {
    const rows = parseCsv("name , price\n\nStole , 649 \n\n");
    expect(rows).toEqual([{ name: "Stole", price: "649" }]);
  });

  it("supports CRLF line endings", () => {
    const rows = parseCsv("name,price\r\nDiya,499\r\n");
    expect(rows).toEqual([{ name: "Diya", price: "499" }]);
  });
});

describe("skusFromCsv", () => {
  it("parses the seed catalog into 8 validated SKUs", () => {
    const skus = skusFromCsv(seedCsv);
    expect(skus).toHaveLength(8);
    const saree = skus.find((s) => s.name === "Cotton Handloom Saree");
    expect(saree).toBeDefined();
    expect(saree?.price_paise).toBe(149900);
    expect(saree?.stock).toBe(15);
    expect(saree?.category).toBe("handloom");
    expect(saree?.tags).toEqual(["saree", "cotton", "gift", "daily"]);
    expect(saree?.id).toBe("sku_cotton-handloom-saree");
  });

  it("keeps the jutti in the footwear category (out of the default allowlist)", () => {
    const skus = skusFromCsv(seedCsv);
    const jutti = skus.find((s) => s.name.includes("Jutti"));
    expect(jutti?.category).toBe("footwear");
  });

  it("tolerates messy merchant headers", () => {
    const skus = skusFromCsv("Product,MRP,Qty\nSilk Dupatta,Rs. 1299,7\n");
    expect(skus).toHaveLength(1);
    expect(skus[0].price_paise).toBe(129900);
    expect(skus[0].stock).toBe(7);
    expect(skus[0].category).toBe("general");
  });

  it("de-duplicates ids for repeated names", () => {
    const skus = skusFromCsv("name,price\nStole,600\nStole,700\n");
    expect(skus.map((s) => s.id)).toEqual(["sku_stole", "sku_stole-2"]);
  });
});

describe("helpers", () => {
  it("slugifies names", () => {
    expect(slugify("Banarasi Silk Saree!")).toBe("banarasi-silk-saree");
  });

  it("picks a fitting emoji", () => {
    expect(pickEmoji("Cotton Handloom Saree")).toBe("🥻");
    expect(pickEmoji("Brass Diya Gift Set")).toBe("🪔");
    expect(pickEmoji("Punjabi Jutti Gold")).toBe("👡");
    expect(pickEmoji("Mystery item")).toBe("🛍️");
  });
});
