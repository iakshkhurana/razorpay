import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";

import {
  clearAllTables,
  closeDb,
  getMerchant,
  getOffer,
  getOrder,
  getOrderByIdempotencyKey,
  getPolicy,
  getSku,
  idempotencyKey,
  insertMandate,
  insertOffer,
  insertOrder,
  isNonceUsed,
  listOrders,
  listSkus,
  markNonceUsed,
  replaceCatalog,
  setPolicy,
  updateOrder,
  upsertMerchant,
} from "./db";
import { DEFAULT_POLICY, type Offer, type Order, type Sku } from "./schemas";

const sku: Sku = {
  id: "sku_test",
  name: "Test Saree",
  description: "",
  price_paise: 149900,
  stock: 3,
  tags: ["saree"],
  category: "handloom",
  image_emoji: "🥻",
};

describe("db", () => {
  beforeAll(() => {
    clearAllTables();
  });
  afterAll(() => {
    closeDb();
  });

  it("round-trips merchant and policy", () => {
    upsertMerchant({ name: "Ramesh Handlooms", live: false });
    expect(getMerchant()?.name).toBe("Ramesh Handlooms");
    expect(getMerchant()?.live).toBe(false);
    upsertMerchant({ name: "Ramesh Handlooms", live: true });
    expect(getMerchant()?.live).toBe(true);

    setPolicy(DEFAULT_POLICY);
    expect(getPolicy()).toEqual(DEFAULT_POLICY);
  });

  it("replaces the catalog atomically", () => {
    replaceCatalog([sku]);
    expect(listSkus()).toHaveLength(1);
    expect(getSku("sku_test")?.tags).toEqual(["saree"]);
    replaceCatalog([{ ...sku, id: "sku_other" }]);
    expect(getSku("sku_test")).toBeNull();
    expect(listSkus()).toHaveLength(1);
  });

  it("stores mandates and tracks nonce use", () => {
    const m = insertMandate({
      id: "mnd_1",
      token: "jwt",
      agent_id: "agent",
      user_ref: "user",
      spend_cap_paise: 200000,
      category_scope: ["handloom"],
      exp: 9999999999,
      nonce: "abcdefgh12345678",
    });
    expect(m.category_scope).toEqual(["handloom"]);
    expect(isNonceUsed(m.nonce)).toBe(false);
    markNonceUsed(m.nonce, m.id);
    expect(isNonceUsed(m.nonce)).toBe(true);
  });

  it("enforces one order per mandate+offer idempotency key", () => {
    const offer: Offer = {
      id: "off_1",
      mandate_id: "mnd_1",
      sku_ids: ["sku_other"],
      qty: 1,
      total_paise: 149900,
      list_total_paise: 149900,
      discount_pct: 0,
      is_bundle: false,
      verdict: {
        decision: "ALLOW",
        reason_code: "OK",
        human_reason: "Within every rule.",
        policy_checks: [{ rule: "all", result: "pass", detail: "ok" }],
      },
      created_at: new Date().toISOString(),
    };
    insertOffer(offer);
    expect(getOffer("off_1")?.verdict.decision).toBe("ALLOW");

    const order: Order = {
      id: "ord_1",
      mandate_id: "mnd_1",
      offer_id: "off_1",
      sku_ids: ["sku_other"],
      qty: 1,
      amount_paise: 149900,
      list_total_paise: 149900,
      upsell_paise: 0,
      status: "AWAITING_PAYMENT",
      payment_url: null,
      payment_ref: null,
      attempts: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    insertOrder(order);
    expect(getOrderByIdempotencyKey(idempotencyKey("mnd_1", "off_1"))?.id).toBe("ord_1");
    expect(() => insertOrder({ ...order, id: "ord_2" })).toThrow();

    updateOrder("ord_1", { status: "PAID", payment_ref: "pay_1" });
    expect(getOrder("ord_1")?.status).toBe("PAID");
    expect(listOrders({ status: "PAID" })).toHaveLength(1);
    expect(listOrders({ status: ["HELD", "FAILED"] })).toHaveLength(0);
  });
});
