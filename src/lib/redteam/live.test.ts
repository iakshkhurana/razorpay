import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { skusFromCsv } from "../catalog";
import { clearAllTables, replaceCatalog, setPolicy, upsertMerchant } from "../db";
import { verifyChain } from "../ledger";
import { DEFAULT_POLICY } from "../schemas";
import { recordShopLive } from "../storefront";
import { LIVE_ATTACK_IDS, isLiveAttackId, liveAttacks, runLiveAttack } from "./live";

/**
 * The console fires the same attacks the scorecard measures, at the live shop.
 * Every one of them must be refused, and the book must survive it.
 */

const seed = skusFromCsv(fs.readFileSync(path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv"), "utf8"));

beforeEach(() => {
  clearAllTables();
  upsertMerchant({ name: "Ramesh Handlooms", live: true });
  replaceCatalog(seed);
  setPolicy(DEFAULT_POLICY);
  recordShopLive("Ramesh Handlooms", seed.length);
});

describe("live red team", () => {
  it("only offers ids it can actually fire", () => {
    expect(liveAttacks().map((a) => a.id)).toEqual([...LIVE_ATTACK_IDS]);
    expect(isLiveAttackId("os-05")).toBe(true);
    expect(isLiveAttackId("rp-01")).toBe(false);
    expect(isLiveAttackId("../../etc/passwd")).toBe(false);
  });

  it("refuses every offered attack, writes it down, and leaves the chain intact", async () => {
    for (const id of LIVE_ATTACK_IDS) {
      const result = await runLiveAttack(id);
      expect(result, `${id} could not be prepared`).not.toBeNull();
      if (!result) continue;

      expect(result.breached, `${id} moved money against the rulebook: ${result.breach_detail.join(", ")}`).toBe(false);
      expect(result.caught, `${id} was not caught by the rule it targets`).toBe(true);
      expect(result.verdicts.length).toBeGreaterThan(0);
      for (const v of result.verdicts) {
        expect(v.human_reason.length).toBeGreaterThan(0);
        expect(v.ledger_entry_id.length).toBeGreaterThan(0);
      }
      expect(result.verdicts.some((v) => v.decision === "DENY" || v.decision === "COUNTER")).toBe(true);
    }
    expect(verifyChain()).toBeNull();
  });
});
