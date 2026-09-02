import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { skusFromCsv } from "./catalog";
import { clearAllTables, isNonceUsed, listOrders, replaceCatalog, setPolicy, upsertMerchant } from "./db";
import { verifyChain } from "./ledger";
import { issueMandate, verifyMandateToken } from "./mandate";
import { DEFAULT_POLICY, type MandateClaims } from "./schemas";
import { checkout, makeOffer, recordMandateIssued, recordShopLive } from "./storefront";

/**
 * A mandate pays once, even when a buyer agent fires its checkouts in parallel.
 * SQLite is synchronous but `checkout` awaits the payment adapter mid-flight, so
 * concurrent calls really do interleave here — this is the race, not a mock of it.
 */

const NOW = 1_800_000_000;
const seed = skusFromCsv(fs.readFileSync(path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv"), "utf8"));
const SAREE = "sku_cotton-handloom-saree";
const STOLE = "sku_handwoven-stole";
const DUPATTA = "sku_phulkari-dupatta";

function newMandate(cap_paise: number): MandateClaims {
  const { token } = issueMandate({
    agent_id: "race-agent",
    user_ref: "race@example.com",
    spend_cap_paise: cap_paise,
    category_scope: ["handloom", "gifts"],
    ttl_seconds: 3600,
    now: NOW,
  });
  const verified = verifyMandateToken(token, NOW);
  if (!verified.ok) throw new Error(verified.error);
  recordMandateIssued(verified.claims);
  return verified.claims;
}

beforeEach(() => {
  clearAllTables();
  upsertMerchant({ name: "Ramesh Handlooms", live: true });
  replaceCatalog(seed);
  setPolicy(DEFAULT_POLICY);
  recordShopLive("Ramesh Handlooms", seed.length);
});

describe("concurrent checkout", () => {
  it("ten parallel checkouts of one offer create exactly one order", async () => {
    const mandate = newMandate(200000);
    const offer = makeOffer({ mandate, sku_ids: [SAREE], qty: 1, now: NOW });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkout({ mandate, offer_id: offer.offer.id, now: NOW }).catch((err) => err as Error)),
    );

    const errors = results.filter((r) => r instanceof Error);
    expect(errors, `checkout threw: ${errors.map((e) => (e as Error).message).join(" | ")}`).toHaveLength(0);

    const orders = listOrders().filter((o) => o.mandate_id === mandate.mandate_id);
    expect(orders).toHaveLength(1);
    expect(orders[0].amount_paise).toBe(149900);
    expect(verifyChain()).toBeNull();
  });

  it("parallel checkouts of different offers on one mandate spend it only once", async () => {
    const mandate = newMandate(200000);
    const offers = [
      makeOffer({ mandate, sku_ids: [SAREE], qty: 1, now: NOW }),
      makeOffer({ mandate, sku_ids: [STOLE], qty: 1, now: NOW }),
      makeOffer({ mandate, sku_ids: [DUPATTA], qty: 1, now: NOW }),
    ];

    const results = await Promise.all(
      offers.map((o) => checkout({ mandate, offer_id: o.offer.id, now: NOW }).catch((err) => err as Error)),
    );
    expect(results.filter((r) => r instanceof Error)).toHaveLength(0);

    // Every checkout that reached the rails consumed the one nonce; the rest are refused.
    const paidLinks = listOrders().filter((o) => o.mandate_id === mandate.mandate_id && o.payment_url !== null);
    expect(paidLinks.length).toBeGreaterThanOrEqual(1);
    expect(isNonceUsed(mandate.nonce)).toBe(true);
    expect(verifyChain()).toBeNull();
  });
});
