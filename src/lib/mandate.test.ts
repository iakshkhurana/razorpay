import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";
const TEST_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.MANDATE_JWT_SECRET = TEST_SECRET;

import { clearAllTables, closeDb, getMandate, listAgents, listUsedNonces, markNonceUsed } from "./db";
import {
  decodeMandateUnsafe,
  issueMandate,
  mandateToDisplay,
  verifyMandateToken,
} from "./mandate";
import { evaluate } from "./policy/engine";
import { DEFAULT_POLICY, MandateClaimsSchema, type MoneyAction, type Sku } from "./schemas";

const NOW = 1_800_000_000;

function issue(overrides: Partial<Parameters<typeof issueMandate>[0]> = {}) {
  return issueMandate({
    agent_id: "buyer-agent-demo",
    user_ref: "priya@example.com",
    spend_cap_paise: 200_000,
    category_scope: ["handloom", "gifts"],
    ttl_seconds: 3600,
    now: NOW,
    ...overrides,
  });
}

/** Swap one character deep inside the signature segment for a different base64url character. */
function tamperSignature(token: string): string {
  const [header, payload, signature] = token.split(".");
  const i = 10;
  const replacement = signature[i] === "a" ? "b" : "a";
  return `${header}.${payload}.${signature.slice(0, i)}${replacement}${signature.slice(i + 1)}`;
}

describe("mandate", () => {
  beforeEach(() => {
    clearAllTables();
  });
  afterEach(() => {
    process.env.MANDATE_JWT_SECRET = TEST_SECRET;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(() => {
    closeDb();
  });

  it("round-trips issue -> verify with identical claims", () => {
    const { mandate, token } = issue();
    const result = verifyMandateToken(token, NOW + 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toEqual({
      mandate_id: mandate.id,
      agent_id: "buyer-agent-demo",
      user_ref: "priya@example.com",
      spend_cap_paise: 200_000,
      category_scope: ["handloom", "gifts"],
      exp: NOW + 3600,
      nonce: mandate.nonce,
    });
    expect(MandateClaimsSchema.safeParse(result.claims).success).toBe(true);
  });

  it("registers the agent in the agents table", () => {
    issue({ agent_id: "agent-x", user_ref: "x@example.com" });
    const agents = listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ agent_id: "agent-x", user_ref: "x@example.com" });
  });

  it("stores the mandate row with its nonce and token", () => {
    const { mandate, token } = issue();
    const stored = getMandate(mandate.id);
    expect(stored).not.toBeNull();
    expect(stored?.nonce).toBe(mandate.nonce);
    expect(stored?.nonce.length).toBeGreaterThanOrEqual(8);
    expect(stored?.token).toBe(token);
    expect(stored?.spent_paise).toBe(0);
    expect(stored?.exp).toBe(NOW + 3600);
  });

  it("refuses to issue a mandate whose cap is not integer paise, before touching the DB", () => {
    expect(() => issue({ spend_cap_paise: 1500.5 })).toThrow();
    expect(() => issue({ spend_cap_paise: 0 })).toThrow();
    expect(listAgents()).toHaveLength(0);
  });

  it("rejects a tampered signature as INVALID_SIGNATURE", () => {
    const { token } = issue();
    const tampered = tamperSignature(token);
    expect(tampered).not.toBe(token);
    expect(verifyMandateToken(tampered, NOW + 10)).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("rejects a tampered payload as INVALID_SIGNATURE", () => {
    const { token } = issue();
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const inflated = Buffer.from(JSON.stringify({ ...claims, spend_cap_paise: 99_999_900 })).toString("base64url");
    expect(verifyMandateToken(`${header}.${inflated}.${signature}`, NOW + 10)).toEqual({
      ok: false,
      error: "INVALID_SIGNATURE",
    });
  });

  it("rejects garbage as MALFORMED without throwing", () => {
    expect(verifyMandateToken("not-a-jwt", NOW)).toEqual({ ok: false, error: "MALFORMED" });
    expect(verifyMandateToken("", NOW)).toEqual({ ok: false, error: "MALFORMED" });
    expect(verifyMandateToken("a.b.c", NOW)).toEqual({ ok: false, error: "MALFORMED" });
  });

  it("rejects a well-signed token whose payload is not a mandate as MALFORMED", () => {
    const token = jwt.sign({ sub: "someone", exp: NOW + 100 }, TEST_SECRET, { algorithm: "HS256" });
    expect(verifyMandateToken(token, NOW)).toEqual({ ok: false, error: "MALFORMED" });
  });

  it("rejects a well-signed token that breaks the mandate schema (float paise, short nonce) as MALFORMED", () => {
    const claims = decodeMandateUnsafe(issue().token);
    expect(claims).not.toBeNull();
    const floatCap = jwt.sign({ ...claims, spend_cap_paise: 150_000.5 }, TEST_SECRET, { algorithm: "HS256" });
    expect(verifyMandateToken(floatCap, NOW + 10)).toEqual({ ok: false, error: "MALFORMED" });
    const shortNonce = jwt.sign({ ...claims, nonce: "abc" }, TEST_SECRET, { algorithm: "HS256" });
    expect(verifyMandateToken(shortNonce, NOW + 10)).toEqual({ ok: false, error: "MALFORMED" });
  });

  it("rejects a token past its exp as EXPIRED using the injected clock", () => {
    const { token, mandate } = issue({ ttl_seconds: 60 });
    expect(verifyMandateToken(token, mandate.exp - 1).ok).toBe(true);
    expect(verifyMandateToken(token, mandate.exp)).toEqual({ ok: false, error: "EXPIRED" });
    expect(verifyMandateToken(token, mandate.exp + 1000)).toEqual({ ok: false, error: "EXPIRED" });
  });

  it("decides expiry from the injected clock, never the system clock", () => {
    vi.useFakeTimers();
    const { token, mandate } = issue({ ttl_seconds: 60 });

    vi.setSystemTime(new Date((mandate.exp + 86_400) * 1000));
    expect(verifyMandateToken(token, NOW + 10).ok).toBe(true);

    vi.setSystemTime(new Date((NOW - 86_400) * 1000));
    expect(verifyMandateToken(token, mandate.exp)).toEqual({ ok: false, error: "EXPIRED" });
  });

  it("rejects a token signed with a different secret as INVALID_SIGNATURE", () => {
    const { token } = issue();
    const claims = decodeMandateUnsafe(token);
    expect(claims).not.toBeNull();
    const forged = jwt.sign({ ...claims }, "some-other-secret-that-is-also-32-chars", { algorithm: "HS256" });
    expect(verifyMandateToken(forged, NOW + 10)).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("rejects an unsigned alg=none token as INVALID_SIGNATURE", () => {
    const { token } = issue();
    const claims = decodeMandateUnsafe(token);
    const unsigned = jwt.sign({ ...claims }, null, { algorithm: "none" });
    expect(verifyMandateToken(unsigned, NOW + 10)).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("rejects a token on any algorithm other than HS256, even with the real secret", () => {
    const { token } = issue();
    const claims = decodeMandateUnsafe(token);
    const hs512 = jwt.sign({ ...claims }, TEST_SECRET, { algorithm: "HS512" });
    expect(jwt.decode(hs512, { complete: true })?.header.alg).toBe("HS512");
    expect(verifyMandateToken(hs512, NOW + 10)).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("gives two issued mandates different ids and nonces", () => {
    const a = issue();
    const b = issue();
    expect(a.mandate.id).not.toBe(b.mandate.id);
    expect(a.mandate.nonce).not.toBe(b.mandate.nonce);
    expect(a.token).not.toBe(b.token);
  });

  it("sets the JWT exp claim equal to the mandate exp", () => {
    const { token, mandate } = issue({ ttl_seconds: 900 });
    const decoded = jwt.decode(token, { json: true });
    expect(decoded?.exp).toBe(mandate.exp);
    expect(decoded?.exp).toBe(NOW + 900);
    expect(decoded?.iat).toBe(NOW);
  });

  it("verified claims drive the policy engine: expiry agrees to the second, replay is the engine's call", () => {
    const catalog: Sku[] = [
      { id: "saree", name: "Cotton Handloom Saree", description: "", price_paise: 149_900, stock: 15, tags: [], category: "handloom", image_emoji: "🥻" },
    ];
    const action: MoneyAction = { type: "checkout", sku_ids: ["saree"], qty: 1, proposed_total_paise: 149_900, discount_pct: 0 };
    const { token } = issue({ ttl_seconds: 60 });

    const fresh = verifyMandateToken(token, NOW + 10);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const { mandate_id, ...mandate } = fresh.claims;

    expect(evaluate(action, mandate, DEFAULT_POLICY, catalog, listUsedNonces(), NOW + 10).decision).toBe("ALLOW");

    markNonceUsed(mandate.nonce, mandate_id);
    expect(verifyMandateToken(token, NOW + 20).ok).toBe(true);
    const replay = evaluate(action, mandate, DEFAULT_POLICY, catalog, listUsedNonces(), NOW + 20);
    expect(replay.decision).toBe("DENY");
    expect(replay.reason_code).toBe("MANDATE_REPLAY");

    expect(verifyMandateToken(token, mandate.exp)).toEqual({ ok: false, error: "EXPIRED" });
    expect(evaluate(action, mandate, DEFAULT_POLICY, catalog, new Set(), mandate.exp).reason_code).toBe("MANDATE_EXPIRED");
  });

  it("decodeMandateUnsafe reads claims without verifying and returns null for junk", () => {
    const { token, mandate } = issue();
    expect(decodeMandateUnsafe(token)?.mandate_id).toBe(mandate.id);
    expect(decodeMandateUnsafe(tamperSignature(token))?.mandate_id).toBe(mandate.id);
    expect(decodeMandateUnsafe("junk")).toBeNull();
    expect(decodeMandateUnsafe(jwt.sign({ sub: "x" }, TEST_SECRET))).toBeNull();
  });

  it("formats a passbook display", () => {
    const { token } = issue({ spend_cap_paise: 184_900, ttl_seconds: 3600 });
    const claims = decodeMandateUnsafe(token);
    expect(claims).not.toBeNull();
    if (!claims) return;
    expect(mandateToDisplay(claims, NOW + 600)).toEqual({
      cap: "₹1,849",
      scope: "handloom, gifts",
      expires_at: new Date((NOW + 3600) * 1000).toISOString(),
      expires_in_seconds: 3000,
    });
    expect(mandateToDisplay(claims, NOW + 5000).expires_in_seconds).toBe(0);
  });

  it("falls back to the .env.example secret with a single warning when the env var is unset", () => {
    delete process.env.MANDATE_JWT_SECRET;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { token } = issue();
    expect(verifyMandateToken(token, NOW + 10).ok).toBe(true);
    expect(verifyMandateToken(token, NOW + 20).ok).toBe(true);
    expect(() =>
      jwt.verify(token, "minimum-32-chars-change-me-please", { algorithms: ["HS256"], clockTimestamp: NOW }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
