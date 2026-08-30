import { describe, expect, it } from "vitest";
import { computeTotals, effectiveFloorPaise, evaluate } from "./engine";
import { DEFAULT_POLICY, type Mandate, type MoneyAction, type Policy, type Sku } from "../schemas";

const NOW = 1_800_000_000;

const catalog: Sku[] = [
  { id: "saree", name: "Cotton Handloom Saree", description: "", price_paise: 149900, stock: 15, tags: [], category: "handloom", image_emoji: "🥻" },
  { id: "blouse", name: "Matching Blouse Piece", description: "", price_paise: 35000, stock: 40, tags: [], category: "handloom", image_emoji: "👚" },
  { id: "banarasi", name: "Banarasi Silk Saree", description: "", price_paise: 499900, stock: 6, tags: [], category: "handloom", image_emoji: "🥻" },
  { id: "stole", name: "Handwoven Stole", description: "", price_paise: 64900, stock: 20, tags: [], category: "handloom", image_emoji: "🧣" },
  { id: "diya", name: "Brass Diya Gift Set", description: "", price_paise: 49900, stock: 25, tags: [], category: "gifts", image_emoji: "🪔" },
  { id: "jutti", name: "Punjabi Jutti Gold", description: "", price_paise: 89900, stock: 10, tags: [], category: "footwear", image_emoji: "👡" },
];

const policy: Policy = DEFAULT_POLICY;

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    agent_id: "buyer-1",
    user_ref: "priya",
    spend_cap_paise: 200000,
    category_scope: ["handloom", "gifts"],
    exp: NOW + 3600,
    nonce: "nonce-0000000001",
    ...overrides,
  };
}

function action(overrides: Partial<MoneyAction> = {}): MoneyAction {
  return {
    type: "offer",
    sku_ids: ["saree"],
    qty: 1,
    proposed_total_paise: 149900,
    discount_pct: 0,
    ...overrides,
  };
}

const none = new Set<string>();

describe("policy engine — happy path", () => {
  it("ALLOWs the demo bundle: saree + blouse = ₹1,849 on a ₹2,000 mandate", () => {
    const v = evaluate(action({ sku_ids: ["saree", "blouse"], proposed_total_paise: 184900 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("ALLOW");
    expect(v.reason_code).toBe("OK");
    expect(v.policy_checks.every((c) => c.result !== "fail")).toBe(true);
    expect(v.policy_checks.length).toBe(10);
  });
});

describe("policy engine — one case per rule", () => {
  it("1. expired mandate → DENY MANDATE_EXPIRED", () => {
    const v = evaluate(action(), mandate({ exp: NOW - 1 }), policy, catalog, none, NOW);
    expect(v.decision).toBe("DENY");
    expect(v.reason_code).toBe("MANDATE_EXPIRED");
  });

  it("2. replayed nonce → DENY MANDATE_REPLAY", () => {
    const v = evaluate(action(), mandate(), policy, catalog, new Set(["nonce-0000000001"]), NOW);
    expect(v.decision).toBe("DENY");
    expect(v.reason_code).toBe("MANDATE_REPLAY");
  });

  it("3. category outside allowlist (jutti is footwear) → DENY CATEGORY_OUT_OF_SCOPE", () => {
    const v = evaluate(action({ sku_ids: ["jutti"], proposed_total_paise: 89900 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("DENY");
    expect(v.reason_code).toBe("CATEGORY_OUT_OF_SCOPE");
    expect(v.human_reason).toMatch(/footwear/);
  });

  it("3b. category inside allowlist but outside the mandate's scope → DENY", () => {
    const v = evaluate(action(), mandate({ category_scope: ["gifts"] }), policy, catalog, none, NOW);
    expect(v.decision).toBe("DENY");
    expect(v.reason_code).toBe("CATEGORY_OUT_OF_SCOPE");
  });

  it("4. unknown SKU → DENY SKU_NOT_FOUND", () => {
    const v = evaluate(action({ sku_ids: ["ghost"], proposed_total_paise: 100 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("DENY");
    expect(v.reason_code).toBe("SKU_NOT_FOUND");
  });

  it("5. total above max order value → DENY ORDER_VALUE_LIMIT", () => {
    const v = evaluate(
      action({ sku_ids: ["banarasi"], qty: 3, proposed_total_paise: 1499700 }),
      mandate({ spend_cap_paise: 2000000 }),
      policy,
      catalog,
      none,
      NOW,
    );
    expect(v.decision).toBe("DENY");
    expect(v.reason_code).toBe("ORDER_VALUE_LIMIT");
  });

  it("6. qty above max → COUNTER QTY_LIMIT at max_qty × list price", () => {
    const v = evaluate(action({ sku_ids: ["stole"], qty: 6, proposed_total_paise: 389400 }), mandate({ spend_cap_paise: 500000 }), policy, catalog, none, NOW);
    expect(v.decision).toBe("COUNTER");
    expect(v.reason_code).toBe("QTY_LIMIT");
    expect(v.counter?.max_total_paise).toBe(64900 * 4);
  });

  it("7. total above spend cap → COUNTER SPEND_CAP_EXCEEDED at exactly the cap", () => {
    const v = evaluate(action({ sku_ids: ["banarasi"], proposed_total_paise: 499900 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("COUNTER");
    expect(v.reason_code).toBe("SPEND_CAP_EXCEEDED");
    expect(v.counter?.max_total_paise).toBe(200000);
  });

  it("8. unit price below floor → COUNTER PRICE_FLOOR at the effective floor", () => {
    const v = evaluate(action({ proposed_total_paise: 100000, discount_pct: 33 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("COUNTER");
    expect(v.reason_code).toBe("PRICE_FLOOR");
    // 85% floor = 127,415 paise; 10% discount limit = 134,910 paise; the counter is the stricter one
    expect(v.counter?.max_total_paise).toBe(134910);
  });

  it("9. discount above max → COUNTER DISCOUNT_LIMIT", () => {
    // 12% off ₹1,499 = ₹1,319.12 → still above the 85% floor, but over the 10% discount limit
    const v = evaluate(action({ proposed_total_paise: 131912, discount_pct: 12 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("COUNTER");
    expect(v.reason_code).toBe("DISCOUNT_LIMIT");
    expect(v.counter?.max_total_paise).toBe(134910);
  });

  it("9b. an undeclared discount is still caught from the implied price", () => {
    const v = evaluate(action({ proposed_total_paise: 131912, discount_pct: 0 }), mandate(), policy, catalog, none, NOW);
    expect(v.reason_code).toBe("DISCOUNT_LIMIT");
  });

  it("10. total above gate → GATE HIGH_VALUE_REVIEW", () => {
    const v = evaluate(
      action({ sku_ids: ["banarasi", "stole"], proposed_total_paise: 564800 }),
      mandate({ spend_cap_paise: 800000 }),
      policy,
      catalog,
      none,
      NOW,
    );
    expect(v.decision).toBe("GATE");
    expect(v.reason_code).toBe("HIGH_VALUE_REVIEW");
    expect(v.counter).toBeUndefined();
  });
});

describe("policy engine — boundaries are inclusive", () => {
  it("total == spend cap passes", () => {
    const v = evaluate(action({ sku_ids: ["saree", "blouse"], proposed_total_paise: 200000 }), mandate(), policy, catalog, none, NOW);
    expect(v.policy_checks.find((c) => c.rule === "spend_cap")?.result).toBe("pass");
    expect(v.decision).toBe("ALLOW");
  });

  it("price == floor passes the floor check", () => {
    const relaxed: Policy = { ...policy, max_discount_pct: 15 };
    const v = evaluate(action({ proposed_total_paise: 127415, discount_pct: 15 }), mandate(), relaxed, catalog, none, NOW);
    expect(v.policy_checks.find((c) => c.rule === "price_floor")?.result).toBe("pass");
    expect(v.decision).toBe("ALLOW");
  });

  it("one paisa under the floor fails it", () => {
    const relaxed: Policy = { ...policy, max_discount_pct: 15 };
    const v = evaluate(action({ proposed_total_paise: 127414, discount_pct: 15 }), mandate(), relaxed, catalog, none, NOW);
    expect(v.reason_code).toBe("PRICE_FLOOR");
  });

  it("total == gate threshold passes without review", () => {
    const v = evaluate(action({ sku_ids: ["banarasi"], proposed_total_paise: 500000 }), mandate({ spend_cap_paise: 800000 }), policy, catalog, none, NOW);
    expect(v.decision).toBe("ALLOW");
  });

  it("qty == max passes", () => {
    const v = evaluate(action({ sku_ids: ["diya"], qty: 4, proposed_total_paise: 199600 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("ALLOW");
  });

  it("mandate valid one second before expiry, expired at exp", () => {
    expect(evaluate(action(), mandate({ exp: NOW + 1 }), policy, catalog, none, NOW).decision).toBe("ALLOW");
    expect(evaluate(action(), mandate({ exp: NOW }), policy, catalog, none, NOW).reason_code).toBe("MANDATE_EXPIRED");
  });
});

describe("policy engine — severity ordering", () => {
  it("DENY beats COUNTER: expired mandate + overspend", () => {
    const v = evaluate(action({ sku_ids: ["banarasi"], proposed_total_paise: 499900 }), mandate({ exp: NOW - 10 }), policy, catalog, none, NOW);
    expect(v.decision).toBe("DENY");
    expect(v.reason_code).toBe("MANDATE_EXPIRED");
    expect(v.policy_checks.filter((c) => c.result === "fail").length).toBe(2);
  });

  it("DENY beats GATE: out-of-scope item above the gate", () => {
    const v = evaluate(action({ sku_ids: ["jutti"], qty: 4, proposed_total_paise: 359600 * 2 }), mandate({ spend_cap_paise: 900000 }), policy, catalog, none, NOW);
    expect(v.decision).toBe("DENY");
  });

  it("an over-cap order is countered, not gated — owner approval cannot lift a buyer's cap", () => {
    const v = evaluate(action({ sku_ids: ["banarasi", "stole"], proposed_total_paise: 564800 }), mandate(), policy, catalog, none, NOW);
    expect(v.decision).toBe("COUNTER");
    expect(v.reason_code).toBe("SPEND_CAP_EXCEEDED");
    expect(v.policy_checks.find((c) => c.rule === "high_value_gate")?.result).toBe("fail");
  });

  it("among bounds, the earlier rule wins: qty before cap", () => {
    const v = evaluate(action({ sku_ids: ["diya"], qty: 5, proposed_total_paise: 249500 }), mandate(), policy, catalog, none, NOW);
    expect(v.reason_code).toBe("QTY_LIMIT");
  });
});

describe("policy engine — replay on the second call", () => {
  it("first checkout passes, the same nonce is denied once consumed", () => {
    const m = mandate();
    const used = new Set<string>();
    const first = evaluate(action({ type: "checkout" }), m, policy, catalog, used, NOW);
    expect(first.decision).toBe("ALLOW");
    used.add(m.nonce);
    const second = evaluate(action({ type: "checkout" }), m, policy, catalog, used, NOW);
    expect(second.decision).toBe("DENY");
    expect(second.reason_code).toBe("MANDATE_REPLAY");
  });
});

describe("policy engine — explainability invariants", () => {
  const scenarios: Array<[string, MoneyAction, Mandate]> = [
    ["allow", action({ sku_ids: ["saree", "blouse"], proposed_total_paise: 184900 }), mandate()],
    ["deny", action({ sku_ids: ["jutti"], proposed_total_paise: 89900 }), mandate()],
    ["counter", action({ sku_ids: ["banarasi"], proposed_total_paise: 499900 }), mandate()],
    ["gate", action({ sku_ids: ["banarasi", "stole"], proposed_total_paise: 564800 }), mandate({ spend_cap_paise: 800000 })],
  ];

  it.each(scenarios)("%s verdict carries a human reason and ≥1 policy check", (_label, a, m) => {
    const v = evaluate(a, m, policy, catalog, none, NOW);
    expect(v.human_reason.length).toBeGreaterThan(10);
    expect(v.policy_checks.length).toBeGreaterThanOrEqual(1);
  });

  it("counter math is exact to the paisa", () => {
    expect(effectiveFloorPaise(149900, policy)).toBe(134910);
    expect(effectiveFloorPaise(184900, policy)).toBe(166410);
    expect(effectiveFloorPaise(1, policy)).toBe(1);
  });

  it("computeTotals multiplies unit sum by qty and reports missing ids", () => {
    const t = computeTotals(action({ sku_ids: ["saree", "blouse", "ghost"], qty: 2 }), catalog);
    expect(t.list_total_paise).toBe((149900 + 35000) * 2);
    expect(t.missing).toEqual(["ghost"]);
    expect(t.units).toBe(4);
  });

  it("is pure: same inputs → identical verdict object", () => {
    const a = action({ sku_ids: ["banarasi"], proposed_total_paise: 499900 });
    expect(evaluate(a, mandate(), policy, catalog, none, NOW)).toEqual(evaluate(a, mandate(), policy, catalog, none, NOW));
  });
});
