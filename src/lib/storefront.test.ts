import { beforeEach, describe, expect, it } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";
process.env.PAYMENTS_MODE = "mock";
process.env.APP_URL = "http://localhost:3000";

import fs from "node:fs";
import path from "node:path";
import { skusFromCsv } from "./catalog";
import { clearAllTables, getMandate, getSku, isNonceUsed, listOrders, replaceCatalog, setPolicy, upsertMerchant } from "./db";
import { listEntries, parsePolicyChecks, verifyChain } from "./ledger";
import { issueMandate, verifyMandateToken } from "./mandate";
import { DEFAULT_POLICY, type MandateClaims } from "./schemas";
import {
  applyPaymentEvent,
  approvalQueue,
  checkout,
  getStats,
  makeOffer,
  orderView,
  ownerDecision,
  recordMandateIssued,
  recordShopLive,
} from "./storefront";

const NOW = 1_800_000_000;
const seed = skusFromCsv(fs.readFileSync(path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv"), "utf8"));
const SAREE = "sku_cotton-handloom-saree";
const BLOUSE = "sku_matching-blouse-piece";
const BANARASI = "sku_banarasi-silk-saree";
const STOLE = "sku_handwoven-stole";
const JUTTI = "sku_punjabi-jutti-gold";

function newMandate(cap_paise: number, scope = ["handloom", "gifts"], ttl = 3600): MandateClaims {
  const { token } = issueMandate({
    agent_id: "buyer-agent-demo",
    user_ref: "priya@example.com",
    spend_cap_paise: cap_paise,
    category_scope: scope,
    ttl_seconds: ttl,
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

describe("flow 1 — happy path with upsell", () => {
  it("saree + blouse bundle is ALLOWed, checked out, paid, and the book explains every hop", async () => {
    const mandate = newMandate(200000);

    const offer = makeOffer({ mandate, sku_ids: [SAREE, BLOUSE], qty: 1, is_bundle: true, now: NOW });
    expect(offer.verdict.decision).toBe("ALLOW");
    expect(offer.offer.total_paise).toBe(184900);

    const result = await checkout({ mandate, offer_id: offer.offer.id, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe("AWAITING_PAYMENT");
    expect(result.order.payment_url).toContain(`/dev/mock-pay?order=${result.order.id}`);
    expect(result.order.upsell_paise).toBe(35000);
    expect(isNonceUsed(mandate.nonce)).toBe(true);

    const paid = await applyPaymentEvent({
      type: "captured",
      payment_ref: result.order.payment_ref as string,
      order_id: result.order.id,
      amount_paise: null,
      raw_event: "mock.success",
    });
    expect(paid.ok && paid.order.status).toBe("PAID");

    expect(getMandate(mandate.mandate_id)?.spent_paise).toBe(184900);
    expect(getSku(SAREE)?.stock).toBe(14);
    expect(getSku(BLOUSE)?.stock).toBe(39);

    const entries = listEntries();
    expect(entries.length).toBeGreaterThanOrEqual(6);
    expect(entries.map((e) => e.verdict)).toEqual(["INFO", "INFO", "ALLOW", "ALLOW", "INFO", "PAID"]);
    expect(verifyChain()).toBeNull();

    const stats = getStats();
    expect(stats.revenue_paise).toBe(184900);
    expect(stats.upsell_paise).toBe(35000);
    expect(stats.orders_paid).toBe(1);
    expect(stats.ledger_intact).toBe(true);
  });

  it("a second capture for the same order is an idempotent no-op", async () => {
    const mandate = newMandate(200000);
    const offer = makeOffer({ mandate, sku_ids: [SAREE], qty: 1, now: NOW });
    const result = await checkout({ mandate, offer_id: offer.offer.id, now: NOW });
    if (!result.ok) throw new Error("checkout failed");
    const event = { type: "captured" as const, payment_ref: result.order.payment_ref as string, order_id: result.order.id, amount_paise: null, raw_event: "mock.success" };
    await applyPaymentEvent(event);
    const before = listEntries().length;
    const again = await applyPaymentEvent(event);
    expect(again.ok && again.duplicate).toBe(true);
    expect(listEntries().length).toBe(before);
    expect(getSku(SAREE)?.stock).toBe(14);
  });

  it("checking out the same offer twice returns the same order", async () => {
    const mandate = newMandate(200000);
    const offer = makeOffer({ mandate, sku_ids: [SAREE], qty: 1, now: NOW });
    const first = await checkout({ mandate, offer_id: offer.offer.id, now: NOW });
    const second = await checkout({ mandate, offer_id: offer.offer.id, now: NOW });
    expect(first.ok && second.ok && first.order.id === second.order.id).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);
    expect(listOrders()).toHaveLength(1);
  });
});

describe("flow 2 — bounded and gated", () => {
  it("two Banarasi sarees over an ₹8,000 cap are COUNTERed at the cap", () => {
    const mandate = newMandate(800000);
    const r = makeOffer({ mandate, sku_ids: [BANARASI], qty: 2, now: NOW });
    expect(r.verdict.decision).toBe("COUNTER");
    expect(r.verdict.reason_code).toBe("SPEND_CAP_EXCEEDED");
    expect(r.verdict.counter?.max_total_paise).toBe(800000);
  });

  it("Banarasi + stole = ₹5,648 is GATEd, parked for the owner, then approved and paid", async () => {
    const mandate = newMandate(800000);
    const r = makeOffer({ mandate, sku_ids: [BANARASI, STOLE], qty: 1, is_bundle: true, now: NOW });
    expect(r.verdict.decision).toBe("GATE");
    expect(r.offer.total_paise).toBe(564800);

    const result = await checkout({ mandate, offer_id: r.offer.id, now: NOW });
    expect(result.ok && result.order.status).toBe("PENDING_APPROVAL");
    expect(result.ok && result.order.payment_url).toBeNull();
    expect(isNonceUsed(mandate.nonce)).toBe(false);
    expect(approvalQueue()).toHaveLength(1);
    expect(approvalQueue()[0].sku_names).toEqual(["Banarasi Silk Saree", "Handwoven Stole"]);

    if (!result.ok) return;
    const approved = await ownerDecision(result.order.id, "approve");
    expect(approved.ok && approved.order.status).toBe("AWAITING_PAYMENT");
    expect(approved.ok && approved.order.payment_url).toContain("/dev/mock-pay");
    expect(isNonceUsed(mandate.nonce)).toBe(true);

    const ownerEntry = listEntries().find((e) => e.reason_code === "OWNER_APPROVED");
    expect(ownerEntry?.actor).toBe("owner");
    expect(ownerEntry?.verdict).toBe("ALLOW");

    const paid = await applyPaymentEvent({ type: "captured", payment_ref: "x", order_id: result.order.id, amount_paise: null, raw_event: "mock.success" });
    expect(paid.ok && paid.order.status).toBe("PAID");
    expect(getStats().revenue_paise).toBe(564800);
    expect(getStats().upsell_paise).toBe(64900);
  });

  it("the owner can reject a gated order and the refusal is written down", async () => {
    const mandate = newMandate(800000);
    const r = makeOffer({ mandate, sku_ids: [BANARASI, STOLE], qty: 1, now: NOW });
    const result = await checkout({ mandate, offer_id: r.offer.id, now: NOW });
    if (!result.ok) throw new Error("expected gated order");
    const rejected = await ownerDecision(result.order.id, "reject");
    expect(rejected.ok && rejected.order.status).toBe("REJECTED");
    const entry = listEntries().at(-1);
    expect(entry?.verdict).toBe("DENY");
    expect(entry?.reason_code).toBe("OWNER_REJECTED");
    expect(entry?.actor).toBe("owner");
    const again = await ownerDecision(result.order.id, "approve");
    expect(again.ok).toBe(false);
  });

  it("asking for a jutti is DENYed and the denial cannot be checked out", async () => {
    const mandate = newMandate(800000);
    const r = makeOffer({ mandate, sku_ids: [JUTTI], qty: 1, now: NOW });
    expect(r.verdict.decision).toBe("DENY");
    expect(r.verdict.reason_code).toBe("CATEGORY_OUT_OF_SCOPE");
    const result = await checkout({ mandate, offer_id: r.offer.id, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.verdict.reason_code).toBe("CATEGORY_OUT_OF_SCOPE");
    expect(listOrders()).toHaveLength(0);
  });
});

describe("flow 3 — graceful failure", () => {
  it("FAILED → HELD → backup link → PAID, with a ledger entry at every hop", async () => {
    const mandate = newMandate(200000);
    const offer = makeOffer({ mandate, sku_ids: [SAREE, BLOUSE], qty: 1, is_bundle: true, now: NOW });
    const result = await checkout({ mandate, offer_id: offer.offer.id, now: NOW });
    if (!result.ok) throw new Error("checkout failed");

    const failed = await applyPaymentEvent({ type: "failed", payment_ref: result.order.payment_ref as string, order_id: result.order.id, amount_paise: null, raw_event: "mock.failure" });
    expect(failed.ok && failed.order.status).toBe("AWAITING_PAYMENT");
    expect(failed.ok && failed.order.attempts).toBe(2);
    expect(failed.ok && failed.order.payment_url).toContain("retry=2");
    expect(failed.ok && orderView(failed.order).held_recovering).toBe(true);

    const verdicts = listEntries().map((e) => e.verdict);
    expect(verdicts.slice(-3)).toEqual(["FAILED", "HELD", "INFO"]);
    expect(listEntries().at(-1)?.reason_code).toBe("FALLBACK_LINK_ISSUED");
    expect(getStats().held_orders).toBe(1);

    const paid = await applyPaymentEvent({ type: "captured", payment_ref: "any", order_id: result.order.id, amount_paise: null, raw_event: "mock.success" });
    expect(paid.ok && paid.order.status).toBe("PAID");
    expect(verifyChain()).toBeNull();
  });

  it("a failure webhook for an unknown order is refused without touching the book", async () => {
    const before = listEntries().length;
    const r = await applyPaymentEvent({ type: "failed", payment_ref: "mockpay_ghost", order_id: "ghost", amount_paise: null, raw_event: "mock.failure" });
    expect(r.ok).toBe(false);
    expect(listEntries().length).toBe(before);
  });
});

describe("mandate boundaries", () => {
  it("a consumed mandate is replay-denied on the next offer", async () => {
    const mandate = newMandate(200000);
    const offer = makeOffer({ mandate, sku_ids: [SAREE], qty: 1, now: NOW });
    await checkout({ mandate, offer_id: offer.offer.id, now: NOW });
    const replay = makeOffer({ mandate, sku_ids: [BLOUSE], qty: 1, now: NOW });
    expect(replay.verdict.decision).toBe("DENY");
    expect(replay.verdict.reason_code).toBe("MANDATE_REPLAY");
  });

  it("an expired mandate is denied and still written to the book", () => {
    const mandate = newMandate(200000, ["handloom", "gifts"], 10);
    const r = makeOffer({ mandate, sku_ids: [SAREE], qty: 1, now: NOW + 11 });
    expect(r.verdict.reason_code).toBe("MANDATE_EXPIRED");
    expect(listEntries().at(-1)?.verdict).toBe("DENY");
  });

  it("a haggle below the floor is countered at the effective floor", () => {
    const mandate = newMandate(200000);
    const r = makeOffer({ mandate, sku_ids: [SAREE], qty: 1, discount_pct: 30, now: NOW });
    expect(r.verdict.decision).toBe("COUNTER");
    expect(r.verdict.reason_code).toBe("PRICE_FLOOR");
    expect(r.verdict.counter?.max_total_paise).toBe(134910);
    expect(r.offer.total_paise).toBe(104930);
  });

  it("checking out an offer that belongs to another mandate is denied", async () => {
    const a = newMandate(200000);
    const b = newMandate(200000);
    const offer = makeOffer({ mandate: a, sku_ids: [SAREE], qty: 1, now: NOW });
    const result = await checkout({ mandate: b, offer_id: offer.offer.id, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.verdict.decision).toBe("DENY");
  });
});

describe("explainability", () => {
  it("every entry carries a human reason and at least one policy check", async () => {
    const mandate = newMandate(800000);
    makeOffer({ mandate, sku_ids: [JUTTI], qty: 1, now: NOW });
    makeOffer({ mandate, sku_ids: [BANARASI], qty: 2, now: NOW });
    const r = makeOffer({ mandate, sku_ids: [BANARASI, STOLE], qty: 1, now: NOW });
    const c = await checkout({ mandate, offer_id: r.offer.id, now: NOW });
    if (c.ok) await ownerDecision(c.order.id, "approve");
    for (const e of listEntries()) {
      expect(e.human_reason.length).toBeGreaterThan(8);
      expect(parsePolicyChecks(e).length).toBeGreaterThanOrEqual(1);
    }
    expect(verifyChain()).toBeNull();
  });
});
