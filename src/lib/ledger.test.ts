import { afterAll, beforeEach, describe, expect, it } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";

import { clearAllTables, closeDb, getDb, ledgerCount, tamperLedgerRow } from "./db";
import {
  appendEntry,
  canonicalJson,
  chainSummary,
  computeHash,
  listEntries,
  parsePolicyChecks,
  PROVENANCE_CHECK,
  recordVerdict,
  verifyChain,
  verifyEntry,
  type AppendEntryInput,
  type UnhashedLedgerEntry,
} from "./ledger";
import { GENESIS_HASH, type PolicyCheck, type Verdict } from "./schemas";

const checks: PolicyCheck[] = [
  { rule: "mandate_expiry", result: "pass", detail: "valid for 3600s more" },
  { rule: "spend_cap", result: "pass", detail: "184900 <= cap 200000" },
];

function append(n: number, overrides: Partial<AppendEntryInput> = {}) {
  return appendEntry({
    actor: "policy_engine",
    mandate_id: "mnd_1",
    action: "offer",
    amount_paise: 100 * n,
    verdict: "ALLOW",
    reason_code: "OK",
    human_reason: `entry ${n} inside every rule`,
    policy_checks: checks,
    ...overrides,
  });
}

/** Raw SQL edits that tamperLedgerRow does not expose, for the harder attacks. */
function rawUpdate(id: string, column: "prev_hash" | "hash" | "policy_checks_json", value: string) {
  getDb().prepare(`UPDATE ledger SET ${column} = ? WHERE id = ?`).run(value, id);
}

const allowVerdict: Verdict = {
  decision: "ALLOW",
  reason_code: "OK",
  human_reason: "₹1,849 is inside every rule — cap, floor, category and limits all pass.",
  policy_checks: checks,
};

const unhashed: UnhashedLedgerEntry = {
  id: "led_fixed",
  ts: "2026-01-01T00:00:00.000Z",
  actor: "policy_engine",
  mandate_id: "mnd_1",
  action: "checkout",
  amount_paise: 184900,
  verdict: "ALLOW",
  reason_code: "OK",
  human_reason: "inside every rule",
  policy_checks_json: JSON.stringify(checks),
  prev_hash: GENESIS_HASH,
};

describe("ledger", () => {
  beforeEach(() => {
    clearAllTables();
  });
  afterAll(() => {
    closeDb();
  });

  describe("hashing", () => {
    it("canonicalJson sorts keys recursively and keeps array order", () => {
      const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }, 1], c: null }, u: undefined });
      const b = canonicalJson({ a: { c: null, d: [3, { y: 2, z: 1 }, 1] }, b: 1 });
      expect(a).toBe(b);
      expect(a).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1},1]},"b":1}');
      expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
    });

    it("computeHash is deterministic, key-order independent and ignores a hash field", () => {
      const first = computeHash(unhashed);
      const reordered = Object.fromEntries(Object.entries(unhashed).reverse()) as UnhashedLedgerEntry;
      expect(computeHash(reordered)).toBe(first);
      expect(computeHash({ ...unhashed, hash: "x".repeat(64) } as UnhashedLedgerEntry)).toBe(first);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    });

    it("computeHash changes with every hashed field, including prev_hash", () => {
      const first = computeHash(unhashed);
      expect(computeHash({ ...unhashed, prev_hash: "1".repeat(64) })).not.toBe(first);
      expect(computeHash({ ...unhashed, amount_paise: 184901 })).not.toBe(first);
      expect(computeHash({ ...unhashed, human_reason: "rewritten" })).not.toBe(first);
      expect(computeHash({ ...unhashed, policy_checks_json: "[]" })).not.toBe(first);
      expect(computeHash({ ...unhashed, verdict: "DENY" })).not.toBe(first);
    });
  });

  describe("chain construction", () => {
    it("empty ledger: verifyChain is null and the summary sits on genesis", () => {
      expect(verifyChain()).toBeNull();
      expect(chainSummary()).toEqual({ count: 0, head_hash: GENESIS_HASH, intact: true, broken_at: null });
    });

    it("first entry links to genesis and carries its own recomputable hash", () => {
      const entry = append(1);
      expect(entry.prev_hash).toBe(GENESIS_HASH);
      expect(entry.hash).toBe(computeHash(entry));
      expect(entry.id).toMatch(/^led_/);
      expect(verifyChain()).toBeNull();
    });

    it("three entries link prev_hash to the previous hash in insertion order", () => {
      const e1 = append(1);
      const e2 = append(2);
      const e3 = append(3);
      expect(e2.prev_hash).toBe(e1.hash);
      expect(e3.prev_hash).toBe(e2.hash);
      expect(new Set([e1.hash, e2.hash, e3.hash]).size).toBe(3);

      expect(listEntries().map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
      expect(verifyChain()).toBeNull();
      expect(chainSummary()).toEqual({ count: 3, head_hash: e3.hash, intact: true, broken_at: null });
    });

    it("Hinglish and rupee text survive the DB round trip with the chain intact", () => {
      const entry = append(1, {
        human_reason: "₹1,849 ka order sab rules ke andar hai — साड़ी और blouse, mom ke liye.",
        reason_code: "OK",
      });
      const stored = listEntries()[0];
      expect(stored).toEqual(entry);
      expect(computeHash(stored)).toBe(entry.hash);
      expect(verifyChain()).toBeNull();
    });

    it("rolls back with an outer transaction so an order and its entry commit together", () => {
      const checkout = getDb().transaction((fail: boolean) => {
        append(1, { action: "checkout" });
        if (fail) throw new Error("order insert failed");
      });

      expect(() => checkout(true)).toThrow("order insert failed");
      expect(ledgerCount()).toBe(0);

      checkout(false);
      expect(ledgerCount()).toBe(1);
      expect(listEntries()[0].prev_hash).toBe(GENESIS_HASH);
      expect(verifyChain()).toBeNull();
    });
  });

  describe("CHAIN-TAMPER", () => {
    it("editing amount_paise of the middle row flags that row", () => {
      append(1);
      const middle = append(2);
      append(3);
      expect(verifyChain()).toBeNull();

      tamperLedgerRow(middle.id, { amount_paise: middle.amount_paise + 1 });

      expect(verifyChain()).toBe(1);
      expect(chainSummary()).toMatchObject({ count: 3, intact: false, broken_at: 1 });
    });

    it("editing human_reason also flags, and the earliest edit wins", () => {
      const first = append(1);
      append(2);
      const third = append(3);

      tamperLedgerRow(third.id, { human_reason: "money moved for a reason it did not" });
      expect(verifyChain()).toBe(2);

      tamperLedgerRow(first.id, { human_reason: "rewritten history" });
      expect(verifyChain()).toBe(0);
    });

    it("re-hashing a tampered row moves the break to its successor", () => {
      append(1);
      const middle = append(2);
      append(3);

      const forged = { ...middle, amount_paise: 1 };
      tamperLedgerRow(middle.id, { amount_paise: forged.amount_paise });
      rawUpdate(middle.id, "hash", computeHash(forged));

      expect(verifyChain()).toBe(2);
    });

    it("re-hashing the last row is the only edit the chain cannot see, and the head hash changes", () => {
      append(1);
      const last = append(2);
      const before = chainSummary().head_hash;

      const forged = { ...last, amount_paise: 1 };
      tamperLedgerRow(last.id, { amount_paise: forged.amount_paise });
      rawUpdate(last.id, "hash", computeHash(forged));

      expect(verifyChain()).toBeNull();
      expect(chainSummary().head_hash).not.toBe(before);
    });

    it("editing policy_checks_json or prev_hash flags the row", () => {
      const first = append(1);
      const second = append(2);

      rawUpdate(second.id, "policy_checks_json", "[]");
      expect(verifyChain()).toBe(1);

      rawUpdate(first.id, "prev_hash", "f".repeat(64));
      expect(verifyChain()).toBe(0);
    });

    it("deleting a middle row flags the row that followed it", () => {
      append(1);
      const middle = append(2);
      append(3);

      getDb().prepare("DELETE FROM ledger WHERE id = ?").run(middle.id);

      expect(ledgerCount()).toBe(2);
      expect(verifyChain()).toBe(1);
    });

    it("swapping the order of two rows flags the first displaced row", () => {
      append(1);
      const second = append(2);
      const third = append(3);

      const d = getDb();
      const seqOf = (id: string) => (d.prepare("SELECT seq FROM ledger WHERE id = ?").get(id) as { seq: number }).seq;
      const s2 = seqOf(second.id);
      const s3 = seqOf(third.id);
      const swap = d.transaction(() => {
        d.prepare("UPDATE ledger SET seq = -1 WHERE id = ?").run(second.id);
        d.prepare("UPDATE ledger SET seq = ? WHERE id = ?").run(s2, third.id);
        d.prepare("UPDATE ledger SET seq = ? WHERE id = ?").run(s3, second.id);
      });
      swap();

      expect(listEntries().map((e) => e.id)[1]).toBe(third.id);
      expect(verifyChain()).toBe(1);
    });
  });

  describe("recordVerdict", () => {
    it("records a DENY verdict like any other money action", () => {
      const verdict: Verdict = {
        decision: "DENY",
        reason_code: "CATEGORY_OUT_OF_SCOPE",
        human_reason: "Punjabi Jutti Gold is footwear — this shop only sells handloom and gifts to AI buyers.",
        policy_checks: [{ rule: "category_scope", result: "fail", detail: "footwear ∉ {handloom, gifts}" }],
      };
      const entry = recordVerdict({ mandate_id: "mnd_1", action: "offer", amount_paise: 89900, verdict });

      expect(entry.verdict).toBe("DENY");
      expect(entry.actor).toBe("policy_engine");
      expect(entry.reason_code).toBe("CATEGORY_OUT_OF_SCOPE");
      expect(entry.human_reason).toBe(verdict.human_reason);
      expect(entry.amount_paise).toBe(89900);
      expect(ledgerCount()).toBe(1);
      expect(listEntries()[0]).toEqual(entry);
      expect(verifyChain()).toBeNull();
    });

    it("stores policy_checks as JSON that parses back unchanged", () => {
      const verdict: Verdict = {
        decision: "COUNTER",
        reason_code: "SPEND_CAP_EXCEEDED",
        human_reason: "₹5,000 is over the buyer's ₹2,000 mandate.",
        counter: { max_total_paise: 200000, suggestion: "Anything up to ₹2,000 works." },
        policy_checks: [
          { rule: "mandate_expiry", result: "pass", detail: "valid for 900s more" },
          { rule: "spend_cap", result: "fail", detail: "500000 > cap 200000" },
          { rule: "price_floor", result: "skip", detail: "no priced basket" },
        ],
      };
      const entry = recordVerdict({
        actor: "seller_agent",
        mandate_id: "mnd_2",
        action: "checkout",
        amount_paise: 500000,
        verdict,
      });

      // the engine's own checks, then the attestation of who decided
      const recorded = [...verdict.policy_checks, PROVENANCE_CHECK];
      expect(entry.actor).toBe("seller_agent");
      expect(JSON.parse(entry.policy_checks_json)).toEqual(recorded);
      expect(parsePolicyChecks(entry)).toEqual(recorded);
      expect(parsePolicyChecks(listEntries()[0])).toEqual(recorded);
      expect(parsePolicyChecks(entry).at(-1)?.detail).toContain("no model in this path");
      expect(parsePolicyChecks({ policy_checks_json: "not json" })).toEqual([]);
      expect(parsePolicyChecks({ policy_checks_json: '[{"rule":"x"}]' })).toEqual([]);
    });

    it("rejects a verdict with no policy checks or a non-money action, writing nothing", () => {
      const bare = { ...allowVerdict, policy_checks: [] } as unknown as Verdict;
      expect(() => recordVerdict({ mandate_id: "mnd_1", action: "offer", amount_paise: 1, verdict: bare })).toThrow();
      expect(() =>
        recordVerdict({ mandate_id: "mnd_1", action: "refund" as "offer", amount_paise: 1, verdict: allowVerdict }),
      ).toThrow();
      expect(() =>
        recordVerdict({ mandate_id: "mnd_1", action: "offer", amount_paise: 18.49, verdict: allowVerdict }),
      ).toThrow();
      expect(ledgerCount()).toBe(0);
    });
  });

  describe("appendEntry boundary", () => {
    it("rejects non-integer paise, empty reasons, unknown actors and bad timestamps without writing", () => {
      expect(() => append(1, { amount_paise: 1849.5 })).toThrow();
      expect(() => append(1, { human_reason: "" })).toThrow();
      expect(() => append(1, { reason_code: "" })).toThrow();
      expect(() => append(1, { actor: "llm" as "system" })).toThrow();
      expect(() => append(1, { verdict: "MAYBE" as "INFO" })).toThrow();
      expect(() => append(1, { ts: "yesterday" })).toThrow();
      expect(ledgerCount()).toBe(0);
      expect(verifyChain()).toBeNull();
    });

    it("requires at least one policy check on a decision but not on lifecycle stamps", () => {
      for (const verdict of ["ALLOW", "COUNTER", "GATE", "DENY"] as const) {
        expect(() => append(1, { verdict, policy_checks: [] })).toThrow();
      }
      expect(ledgerCount()).toBe(0);

      for (const verdict of ["PAID", "FAILED", "HELD", "INFO"] as const) {
        append(1, { actor: "payments", verdict, reason_code: verdict, policy_checks: [] });
      }
      expect(ledgerCount()).toBe(4);
      expect(verifyChain()).toBeNull();
    });

    it("honours explicit id/ts and lists newest-first with a limit", () => {
      const e1 = append(1, { id: "led_a", ts: "2026-01-01T00:00:00.000Z" });
      const e2 = append(2);
      const e3 = append(3);
      expect(e1.id).toBe("led_a");
      expect(e1.ts).toBe("2026-01-01T00:00:00.000Z");

      expect(listEntries({ order: "desc", limit: 2 }).map((e) => e.id)).toEqual([e3.id, e2.id]);
      expect(listEntries({ limit: 1 })[0].id).toBe("led_a");
    });

    it("refuses a duplicate id and leaves the chain untouched", () => {
      append(1, { id: "led_a" });
      const e2 = append(2);
      expect(() => append(3, { id: "led_a" })).toThrow();
      expect(ledgerCount()).toBe(2);
      expect(chainSummary()).toEqual({ count: 2, head_hash: e2.hash, intact: true, broken_at: null });
      expect(append(4).prev_hash).toBe(e2.hash);
    });
  });
  describe("verifyEntry", () => {
    it("recomputes one row's hash and its link to the row before it", () => {
      const e1 = append(1);
      const e2 = append(2);

      const first = verifyEntry(e1.id);
      expect(first).toMatchObject({ id: e1.id, index: 0, ok: true, body_ok: true, link_ok: true, expected_prev_hash: GENESIS_HASH });
      expect(first?.computed_hash).toBe(e1.hash);

      const second = verifyEntry(e2.id);
      expect(second).toMatchObject({ index: 1, ok: true, expected_prev_hash: e1.hash });
      expect(verifyEntry("led_nope")).toBeNull();
    });

    it("names the edited row: an altered body fails its own hash, and the row after it loses its link", () => {
      const e1 = append(1);
      const e2 = append(2);
      tamperLedgerRow(e1.id, { human_reason: "nothing to see here" });

      const edited = verifyEntry(e1.id);
      expect(edited?.ok).toBe(false);
      expect(edited?.body_ok).toBe(false);
      expect(edited?.link_ok).toBe(true);
      expect(edited?.computed_hash).not.toBe(edited?.stored_hash);

      // e2 still stores the pre-edit hash of e1, which no longer matches
      const after = verifyEntry(e2.id);
      expect(after?.body_ok).toBe(true);
      expect(after?.link_ok).toBe(true);
      expect(verifyChain()).toBe(0);
    });

    it("catches a re-linked row even when its own hash was recomputed", () => {
      append(1);
      const e2 = append(2);
      rawUpdate(e2.id, "prev_hash", GENESIS_HASH);

      const relinked = verifyEntry(e2.id);
      expect(relinked?.link_ok).toBe(false);
      expect(relinked?.ok).toBe(false);
    });
  });
});
