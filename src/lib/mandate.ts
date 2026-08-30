import jwt from "jsonwebtoken";
import { insertMandate, type MandateRecord, upsertAgent } from "./db";
import { newId, newNonce } from "./ids";
import { formatINR } from "./money";
import { type MandateClaims, MandateClaimsSchema, type MandateIssueRequest } from "./schemas";
import { nowSeconds } from "./utils";

/**
 * Signed mandates: the buyer agent's proof of what it may spend, on what, until when.
 *
 * Claims are the JWT payload verbatim (plus the standard `iat`). The JWT's own `exp`
 * IS the mandate's `exp`, so the library's expiry check and the policy engine's
 * rule 1 agree on the same second.
 */

const ALGORITHM = "HS256" as const;

/** Matches .env.example so the demo boots with no .env at all. */
const FALLBACK_SECRET = "minimum-32-chars-change-me-please";

let warnedAboutFallback = false;

function mandateSecret(): string {
  const configured = process.env.MANDATE_JWT_SECRET;
  if (configured && configured.length > 0) return configured;
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "MANDATE_JWT_SECRET is not set; signing mandates with the .env.example default. Set it before any real deployment.",
    );
  }
  return FALLBACK_SECRET;
}

/* ------------------------------------------------------------------ */
/*  Issue                                                              */
/* ------------------------------------------------------------------ */

export interface IssueMandateInput extends MandateIssueRequest {
  /** unix seconds; defaults to the current clock */
  now?: number;
}

export interface IssuedMandate {
  mandate: MandateRecord;
  token: string;
}

export function signMandateClaims(claims: MandateClaims, issuedAt: number): string {
  return jwt.sign({ ...claims, iat: issuedAt }, mandateSecret(), { algorithm: ALGORITHM });
}

/** Demo helper behind POST /api/mandate/issue: signs, registers the agent, stores the mandate. */
export function issueMandate(input: IssueMandateInput): IssuedMandate {
  const now = input.now ?? nowSeconds();
  const claims = MandateClaimsSchema.parse({
    mandate_id: newId("mnd", now * 1000),
    agent_id: input.agent_id,
    user_ref: input.user_ref,
    spend_cap_paise: input.spend_cap_paise,
    category_scope: input.category_scope,
    exp: now + input.ttl_seconds,
    nonce: newNonce(),
  });
  const token = signMandateClaims(claims, now);

  upsertAgent(claims.agent_id, claims.user_ref);
  const { mandate_id, ...mandate } = claims;
  const record = insertMandate({ id: mandate_id, token, ...mandate });

  return { mandate: record, token };
}

/* ------------------------------------------------------------------ */
/*  Verify                                                             */
/* ------------------------------------------------------------------ */

export type MandateVerifyError = "EXPIRED" | "INVALID_SIGNATURE" | "MALFORMED";

export type MandateVerifyResult =
  | { ok: true; claims: MandateClaims }
  | { ok: false; error: MandateVerifyError };

const SIGNATURE_FAILURES = new Set(["invalid signature", "jwt signature is required", "invalid algorithm"]);

function classifyVerifyError(err: unknown): MandateVerifyError {
  if (err instanceof jwt.TokenExpiredError) return "EXPIRED";
  if (err instanceof jwt.JsonWebTokenError && SIGNATURE_FAILURES.has(err.message)) return "INVALID_SIGNATURE";
  return "MALFORMED";
}

/**
 * Never throws. Expiry is decided against the caller's `now` (unix seconds), never
 * the wall clock, so it agrees with the policy engine's rule 1 to the second —
 * pass the same `now` to both.
 */
export function verifyMandateToken(token: string, now: number): MandateVerifyResult {
  let payload: unknown;
  try {
    payload = jwt.verify(token, mandateSecret(), { algorithms: [ALGORITHM], clockTimestamp: now });
  } catch (err) {
    return { ok: false, error: classifyVerifyError(err) };
  }

  const parsed = MandateClaimsSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "MALFORMED" };
  return { ok: true, claims: parsed.data };
}

/* ------------------------------------------------------------------ */
/*  Display                                                            */
/* ------------------------------------------------------------------ */

/**
 * Reads the claims WITHOUT checking the signature or expiry. Display only
 * (the simulator's passbook stub); never feed its output to the policy engine.
 */
export function decodeMandateUnsafe(token: string): MandateClaims | null {
  try {
    const payload = jwt.decode(token, { json: true });
    const parsed = MandateClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface MandateDisplay {
  cap: string;
  scope: string;
  /** ISO-8601 */
  expires_at: string;
  /** clamped at zero once expired */
  expires_in_seconds: number;
}

export function mandateToDisplay(claims: MandateClaims, now: number = nowSeconds()): MandateDisplay {
  return {
    cap: formatINR(claims.spend_cap_paise),
    scope: claims.category_scope.length > 0 ? claims.category_scope.join(", ") : "none",
    expires_at: new Date(claims.exp * 1000).toISOString(),
    expires_in_seconds: Math.max(0, claims.exp - now),
  };
}
