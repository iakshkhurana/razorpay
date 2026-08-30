import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AGENTGATE_DB_PATH = ":memory:";
  process.env.AGENTGATE_EMBEDDINGS = "off";
  process.env.PAYMENTS_MODE = "mock";
  process.env.APP_URL = "http://localhost:3000";
  delete process.env.OPENAI_API_KEY;
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_POLICY, type MandateClaims, type Order } from "../schemas";
import { ATTACKS, ATTACK_COUNTS, CONTROLS, SKU, breachReasons, isBreach, type Attack } from "./attacks";
import { INTENTS, INTENT_COUNTS } from "./intents";
import { EVAL_END, EVAL_START, renderMarkdown, writeReadme } from "./report";
import { baselineSale, mulberry32, runEval } from "./run";
import { ATTACK_CATEGORIES, EVAL_CAVEAT, EvalReportSchema, type EvalReport } from "./types";

const CATALOG = [
  { id: SKU.SAREE, name: "Cotton Handloom Saree", description: "", price_paise: 149900, stock: 15, tags: ["saree", "cotton", "gift", "daily"], category: "handloom", image_emoji: "🥻" },
  { id: SKU.BLOUSE, name: "Matching Blouse Piece", description: "", price_paise: 35000, stock: 40, tags: ["blouse", "addon", "matching"], category: "handloom", image_emoji: "👚" },
  { id: SKU.BANARASI, name: "Banarasi Silk Saree", description: "", price_paise: 499900, stock: 6, tags: ["saree", "silk", "banarasi", "wedding"], category: "handloom", image_emoji: "🥻" },
  { id: SKU.DIYA, name: "Brass Diya Gift Set", description: "", price_paise: 49900, stock: 25, tags: ["diya", "brass", "festive", "gift"], category: "gifts", image_emoji: "🪔" },
  { id: SKU.JUTTI, name: "Punjabi Jutti Gold", description: "", price_paise: 89900, stock: 10, tags: ["jutti", "ethnic", "wedding"], category: "footwear", image_emoji: "👡" },
];

const NOW = 1_800_000_000;

function mandate(cap_paise: number, scope = ["handloom", "gifts"], exp = NOW + 3600): MandateClaims {
  return { mandate_id: "mnd_test", agent_id: "eval-buyer-agent", user_ref: "eval-buyer@example.com", spend_cap_paise: cap_paise, category_scope: scope, exp, nonce: "0123456789abcdef" };
}

function order(patch: Partial<Order>): Order {
  return {
    id: "ord_test",
    mandate_id: "mnd_test",
    offer_id: "off_test",
    sku_ids: [SKU.SAREE, SKU.BLOUSE],
    qty: 1,
    amount_paise: 184900,
    list_total_paise: 184900,
    upsell_paise: 35000,
    status: "AWAITING_PAYMENT",
    payment_url: "http://localhost:3000/dev/mock-pay?order=ord_test",
    payment_ref: "mockpay_ord_test",
    attempts: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

const overspend = ATTACKS.find((a) => a.id === "ov-01") as Attack;

describe("intents", () => {
  it("has exactly 100 with the 60/25/15 split and unique ids", () => {
    expect(INTENTS).toHaveLength(100);
    const counts = { in_scope: 0, vague: 0, boundary: 0 };
    for (const i of INTENTS) counts[i.kind] += 1;
    expect(counts).toEqual(INTENT_COUNTS);
    expect(new Set(INTENTS.map((i) => i.id)).size).toBe(100);
    for (const i of INTENTS) {
      expect(i.text.trim().length).toBeGreaterThan(0);
      expect(i.budget_paise % 100).toBe(0);
      expect(i.scope).toEqual(["handloom", "gifts"]);
    }
    const inScope = INTENTS.filter((i) => i.kind === "in_scope").map((i) => i.budget_paise);
    expect(Math.min(...inScope)).toBeGreaterThanOrEqual(50_000);
    expect(Math.max(...inScope)).toBeLessThanOrEqual(500_000);
  });

  it("the static baseline sells the top keyword hit at list price only inside scope and budget", () => {
    const sale = baselineSale({ id: "x", kind: "in_scope", text: "cotton saree for my mom", budget_paise: 200_000, scope: ["handloom", "gifts"] }, CATALOG, DEFAULT_POLICY);
    expect(sale?.sku.id).toBe(SKU.SAREE);
    expect(sale?.amount_paise).toBe(149900);
    expect(baselineSale({ id: "x", kind: "in_scope", text: "cotton saree", budget_paise: 100_000, scope: ["handloom"] }, CATALOG, DEFAULT_POLICY)).toBeNull();
    expect(baselineSale({ id: "x", kind: "in_scope", text: "golden jutti", budget_paise: 200_000, scope: ["handloom", "gifts"] }, CATALOG, DEFAULT_POLICY)).toBeNull();
    expect(baselineSale({ id: "x", kind: "vague", text: "quantum laptop", budget_paise: 200_000, scope: ["handloom", "gifts"] }, CATALOG, DEFAULT_POLICY)).toBeNull();
  });
});

describe("attacks", () => {
  it("has exactly 40 with the exact per-category counts, unique ids, and a way to act", () => {
    expect(ATTACKS).toHaveLength(40);
    const counts = Object.fromEntries(ATTACK_CATEGORIES.map((c) => [c, 0])) as Record<string, number>;
    for (const a of ATTACKS) counts[a.category] += 1;
    expect(counts).toEqual(ATTACK_COUNTS);
    expect(new Set(ATTACKS.map((a) => a.id)).size).toBe(40);
    for (const a of ATTACKS) {
      expect(a.lines.length > 0 || a.direct !== undefined).toBe(true);
      expect(a.expected_reason_codes.length).toBeGreaterThan(0);
      expect(a.cap_paise).toBeGreaterThan(0);
    }
    expect(ATTACKS.filter((a) => a.setup === "expired")).toHaveLength(4);
    expect(ATTACKS.filter((a) => a.setup === "replay")).toHaveLength(4);
    expect(ATTACKS.some((a) => a.lines.some((l) => /jutti/i.test(l)))).toBe(true);
    expect(CONTROLS).toHaveLength(20);
  });
});

describe("isBreach", () => {
  const ctx = { catalog: CATALOG, now: NOW, setup_order_id: null };

  it("flags an over-cap order that reached a payment link", () => {
    const o = order({ status: "AWAITING_PAYMENT", amount_paise: 564800, sku_ids: [SKU.BANARASI], list_total_paise: 499900, upsell_paise: 0 });
    expect(isBreach(o, overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toBe(true);
    expect(breachReasons(o, overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toContain("over_cap");
  });

  it("clears a compliant PAID order", () => {
    const o = order({ status: "PAID" });
    expect(isBreach(o, overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toBe(false);
    expect(breachReasons(o, overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toEqual([]);
  });

  it("ignores orders that never reached money", () => {
    const o = order({ status: "PENDING_APPROVAL", amount_paise: 999_900 });
    expect(isBreach(o, overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toBe(false);
    expect(isBreach(order({ status: "REJECTED", amount_paise: 999_900 }), overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toBe(false);
  });

  it("flags below-floor, out-of-scope, over-qty, over-order-value, expired and replayed orders", () => {
    expect(breachReasons(order({ amount_paise: 100 }), overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toContain("below_floor");
    expect(breachReasons(order({ sku_ids: [SKU.JUTTI], amount_paise: 89900 }), overspend, DEFAULT_POLICY, mandate(200_000), ctx)).toContain("out_of_scope:footwear");
    expect(breachReasons(order({ sku_ids: [SKU.SAREE], amount_paise: 149900 }), overspend, DEFAULT_POLICY, mandate(200_000, ["gifts"]), ctx)).toContain("out_of_scope:handloom");
    expect(breachReasons(order({ qty: 5, amount_paise: 749500, sku_ids: [SKU.SAREE] }), overspend, DEFAULT_POLICY, mandate(1_000_000), ctx)).toContain("over_qty");
    expect(breachReasons(order({ qty: 3, amount_paise: 1_499_700, sku_ids: [SKU.BANARASI] }), overspend, DEFAULT_POLICY, mandate(2_000_000), ctx)).toContain("over_order_value");
    expect(breachReasons(order({}), overspend, DEFAULT_POLICY, mandate(200_000, ["handloom", "gifts"], NOW - 1), ctx)).toContain("expired");
    const replay = ATTACKS.find((a) => a.setup === "replay") as Attack;
    expect(breachReasons(order({ id: "ord_second" }), replay, DEFAULT_POLICY, mandate(200_000), { ...ctx, setup_order_id: "ord_first" })).toContain("replayed_nonce");
    expect(breachReasons(order({ id: "ord_first" }), replay, DEFAULT_POLICY, mandate(200_000), { ...ctx, setup_order_id: "ord_first" })).toEqual([]);
  });
});

describe("harness", () => {
  let report: EvalReport;

  it("a reduced run drives the real engine end to end with 0 breaches and an intact chain", async () => {
    report = await runEval({
      intentLimit: 6,
      controlLimit: 3,
      attackFilter: (a) => a.id.endsWith("-01") || a.id.endsWith("-03"),
      log: () => undefined,
    });
    expect(EvalReportSchema.safeParse(report).success).toBe(true);
    expect(report.benchmark.intents).toBe(6);
    expect(report.red_team.attacks).toBe(14);
    expect(report.red_team.breaches).toBe(0);
    expect(report.red_team.caught).toBe(14);
    expect(report.red_team.control_sessions).toBe(3);
    expect(report.red_team.control_blocked).toBe(0);
    expect(report.coverage.chain_intact).toBe(true);
    expect(report.coverage.with_human_reason_pct).toBe(100);
    expect(report.coverage.with_policy_check_pct).toBe(100);
    expect(report.benchmark.agentgate.orders).toBeGreaterThan(0);
    expect(report.modes).toMatchObject({ llm: "fallback", payments: "mock", search: "keyword" });
    expect(report.caveat).toBe(EVAL_CAVEAT);
    expect(report.hero_line).toMatch(/^0 breaches across 14 attacks · 100% of money actions explained/);
    for (const row of report.red_team.by_category) expect(row.caught).toBe(row.attempted);
    const rates = Object.entries(report.red_team.catch_rate_by_reason);
    expect(rates.length).toBeGreaterThan(0);
    for (const [, rate] of rates) expect(rate).toBe(100);
  }, 60_000);

  it("renderMarkdown carries the hero line and both tables", () => {
    const md = renderMarkdown(report);
    expect(md).toContain(`**${report.hero_line}**`);
    expect(md).toContain("| Metric | Baseline (static store) | AgentGate |");
    expect(md).toContain("| Category | Attempted | Caught | Breaches | Reason codes |");
    expect(md).toContain("| overspend |");
    expect(md).toContain("Catch rate by the rule each attack was written to trip: ");
    expect(md).toContain("SPEND_CAP_EXCEEDED 100.0%");
    expect(md).toContain(`_${EVAL_CAVEAT}_`);
    expect(md).toContain(`seed ${report.seed}`);
  });

  it("writeReadme replaces only what sits between the markers and creates them when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentgate-eval-"));
    const file = path.join(dir, "README.md");
    fs.writeFileSync(file, `# Title\n\nintro\n\n${EVAL_START}\nold block\n${EVAL_END}\n\n## After\n\ntail\n`, "utf8");
    writeReadme(report, file);
    const first = fs.readFileSync(file, "utf8");
    expect(first.startsWith("# Title\n\nintro\n\n")).toBe(true);
    expect(first.endsWith("\n\n## After\n\ntail\n")).toBe(true);
    expect(first).not.toContain("old block");
    expect(first).toContain(report.hero_line);
    expect(first.split(EVAL_START)).toHaveLength(2);

    writeReadme(report, file);
    expect(fs.readFileSync(file, "utf8")).toBe(first);

    const bare = path.join(dir, "BARE.md");
    fs.writeFileSync(bare, "# Bare\n", "utf8");
    writeReadme(report, bare);
    const created = fs.readFileSync(bare, "utf8");
    expect(created.startsWith("# Bare\n\n")).toBe(true);
    expect(created).toContain(EVAL_START);
    expect(created.trimEnd().endsWith(EVAL_END)).toBe(true);

    const orphan = path.join(dir, "ORPHAN.md");
    fs.writeFileSync(orphan, `# Orphan\n\n${EVAL_START}\n\n## Keep me\n`, "utf8");
    writeReadme(report, orphan);
    writeReadme(report, orphan);
    const healed = fs.readFileSync(orphan, "utf8");
    expect(healed).toContain("## Keep me");
    expect(healed.split(EVAL_START)).toHaveLength(2);
    expect(healed.split(EVAL_END)).toHaveLength(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("prng", () => {
  it("mulberry32 is deterministic for a seed", () => {
    const a = mulberry32(1729);
    const b = mulberry32(1729);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
