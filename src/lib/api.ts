import { NextResponse } from "next/server";
import type { z } from "zod";
import { appendEntry } from "./ledger";
import { decodeMandateUnsafe, verifyMandateToken, type MandateVerifyError } from "./mandate";
import type { MandateClaims } from "./schemas";
import { nowSeconds } from "./utils";

/** Route-handler helpers: one place for JSON, validation and mandate checks. */

export function json<T>(body: T, init: number | ResponseInit = 200): NextResponse {
  return NextResponse.json(body, typeof init === "number" ? { status: init } : init);
}

export function error(message: string, status = 400, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export async function parseBody<T>(req: Request, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: error("Request body must be JSON.", 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, response: error(`${where}${issue?.message ?? "invalid body"}`, 422, { issues: result.error.issues }) };
  }
  return { ok: true, data: result.data };
}

export type MandateCheck =
  | { ok: true; claims: MandateClaims; now: number }
  | { ok: false; response: NextResponse; reason: MandateVerifyError };

const VERIFY_MESSAGE: Record<MandateVerifyError, string> = {
  EXPIRED: "This mandate has expired. Issue a fresh one before trying again.",
  INVALID_SIGNATURE: "This mandate was not signed by AgentGate. Nothing was sold.",
  MALFORMED: "This mandate token is not readable. Issue a fresh one.",
};

/**
 * Verifies a mandate token. A refused mandate is still a money action from the
 * book's point of view, so the refusal is written down before the 401 goes out.
 */
export function requireMandate(token: string, action: string): MandateCheck {
  const now = nowSeconds();
  const verified = verifyMandateToken(token, now);
  if (verified.ok) return { ok: true, claims: verified.claims, now };

  const claims = decodeMandateUnsafe(token);
  const reason_code = verified.error === "EXPIRED" ? "MANDATE_EXPIRED" : `MANDATE_${verified.error}`;
  const entry = appendEntry({
    actor: "policy_engine",
    mandate_id: claims?.mandate_id ?? "",
    action,
    amount_paise: 0,
    verdict: "DENY",
    reason_code,
    human_reason: VERIFY_MESSAGE[verified.error],
    policy_checks: [{ rule: "mandate_signature", result: "fail", detail: verified.error }],
  });
  return {
    ok: false,
    reason: verified.error,
    response: error(VERIFY_MESSAGE[verified.error], 401, {
      verdict: { decision: "DENY", reason_code, human_reason: VERIFY_MESSAGE[verified.error], policy_checks: [] },
      ledger_entry_id: entry.id,
    }),
  };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.AGENTGATE_ALLOW_DEV_ROUTES === "1";
}
