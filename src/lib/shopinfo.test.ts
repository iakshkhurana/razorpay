import { beforeEach, describe, expect, it } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";

import { clearAllTables, replaceCatalog, setPolicy, upsertMerchant } from "./db";
import { seedSkus } from "./seed";
import { DEFAULT_POLICY } from "./schemas";
import { answerShopInfo, buildShopChunks, isShopQuestion, scoreChunks } from "./shopinfo";

describe("shopinfo", () => {
  beforeEach(() => {
    clearAllTables();
    upsertMerchant({ name: "Ramesh Handlooms", live: true });
    replaceCatalog(seedSkus());
    setPolicy(DEFAULT_POLICY);
  });

  it("answers a returns question from the rulebook with a citation", () => {
    const a = answerShopInfo("What is your return policy?");
    expect(a.answer).toContain("7-day easy returns");
    expect(a.citations[0].source).toBe("Rulebook · Returns");
  });

  it("answers the same question asked in Hindi", () => {
    const a = answerShopInfo("वापसी की नीति क्या है?");
    expect(a.citations[0]?.source).toBe("Rulebook · Returns");
  });

  it("answers a discount-rules question from the pricing chunk", () => {
    const a = answerShopInfo("How much discount is allowed at most?");
    expect(a.answer).toContain("Maximum discount: 10%");
    expect(a.citations[0].source).toBe("Rulebook · Pricing");
  });

  it("says nothing when the corpus has no match", () => {
    const a = answerShopInfo("qwerty zxcvb");
    expect(a.answer).toBeNull();
    expect(a.citations).toHaveLength(0);
  });

  it("cites the catalog for product questions", () => {
    const a = answerShopInfo("Is the Banarasi silk saree good for weddings?");
    expect(a.chunks.some((c) => c.source === "Catalog · Banarasi Silk Saree")).toBe(true);
  });

  it("classifies shop questions vs buying intents", () => {
    expect(isShopQuestion("What is your return policy?")).toBe(true);
    expect(isShopQuestion("wapsi ka niyam kya hai")).toBe(true);
    expect(isShopQuestion("I want a cotton saree under 2000")).toBe(false);
  });

  it("scoring is deterministic and ranked", () => {
    const chunks = buildShopChunks(DEFAULT_POLICY, seedSkus(), "Ramesh Handlooms");
    const scored = scoreChunks("returns refund policy", chunks);
    expect(scored[0].source).toBe("Rulebook · Returns");
    expect(scored.every((c, i) => i === 0 || c.score <= scored[i - 1].score)).toBe(true);
  });
});
