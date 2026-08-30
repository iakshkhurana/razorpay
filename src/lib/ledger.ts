import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb, insertLedgerRow, lastLedgerRow, ledgerCount, listLedgerRows } from "./db";
import { newId } from "./ids";
import {
  DecisionSchema,
  GENESIS_HASH,
  LedgerActorSchema,
  LedgerVerdictSchema,
  MoneyActionTypeSchema,
  PolicyCheckSchema,
  VerdictSchema,
  type LedgerEntry,
  type PolicyCheck,
} from "./schemas";
import { nowIso } from "./utils";

/**
 * Hash-chained ledger.
 *
 * Every entry's `hash` is sha256 over the canonical JSON of the entry WITHOUT its
 * `hash` field, with `prev_hash` appended as a plain string. The first entry links
 * to GENESIS_HASH (64 zeros). Editing, deleting or re-ordering any stored row breaks
 * the recomputation for that row or the one after it, which `verifyChain` reports
 * as the first broken 0-based index.
 */

export type UnhashedLedgerEntry = Omit<LedgerEntry, "hash">;

/* ------------------------------------------------------------------ */
/*  Canonical JSON & hashing                                           */
/* ------------------------------------------------------------------ */

/**
 * Deterministic JSON: object keys sorted recursively, arrays keep their order,
 * `undefined` members dropped (as JSON.stringify does). No whitespace.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(",")}}`;
}

/** Only the schema fields take part in the hash, so stray row columns can never shift it. */
function hashBody(entry: UnhashedLedgerEntry): Record<string, unknown> {
  return {
    id: entry.id,
    ts: entry.ts,
    actor: entry.actor,
    mandate_id: entry.mandate_id,
    action: entry.action,
    amount_paise: entry.amount_paise,
    verdict: entry.verdict,
    reason_code: entry.reason_code,
    human_reason: entry.human_reason,
    policy_checks_json: entry.policy_checks_json,
    prev_hash: entry.prev_hash,
  };
}

export function computeHash(entry: UnhashedLedgerEntry): string {
  return createHash("sha256")
    .update(canonicalJson(hashBody(entry)) + entry.prev_hash)
    .digest("hex");
}

/* ------------------------------------------------------------------ */
/*  Writing                                                            */
/* ------------------------------------------------------------------ */

const PolicyChecksSchema = z.array(PolicyCheckSchema);

function isDecision(verdict: string): boolean {
  return DecisionSchema.safeParse(verdict).success;
}

export const AppendEntryInputSchema = z
  .object({
    actor: LedgerActorSchema,
    mandate_id: z.string(),
    action: z.string().min(1),
    amount_paise: z.number().int(),
    verdict: LedgerVerdictSchema,
    reason_code: z.string().min(1),
    human_reason: z.string().min(1),
    policy_checks: PolicyChecksSchema,
    /** ISO-8601; defaults to now */
    ts: z.string().datetime().optional(),
    id: z.string().min(1).optional(),
  })
  .refine((v) => !isDecision(v.verdict) || v.policy_checks.length > 0, {
    message: "A policy decision must carry at least one policy check.",
    path: ["policy_checks"],
  });
export type AppendEntryInput = z.infer<typeof AppendEntryInputSchema>;

/**
 * Appends one entry to the chain. Input is validated before any lock is taken; the
 * read of the current head and the insert then run inside a single immediate
 * transaction, so two writers can never link to the same predecessor. Called from
 * within an outer transaction it becomes a savepoint and rolls back with it.
 */
export function appendEntry(input: AppendEntryInput): LedgerEntry {
  const valid = AppendEntryInputSchema.parse(input);
  const tx = getDb().transaction((): LedgerEntry => {
    const unhashed: UnhashedLedgerEntry = {
      id: valid.id ?? newId("led"),
      ts: valid.ts ?? nowIso(),
      actor: valid.actor,
      mandate_id: valid.mandate_id,
      action: valid.action,
      amount_paise: valid.amount_paise,
      verdict: valid.verdict,
      reason_code: valid.reason_code,
      human_reason: valid.human_reason,
      policy_checks_json: JSON.stringify(valid.policy_checks),
      prev_hash: lastLedgerRow()?.hash ?? GENESIS_HASH,
    };
    const entry: LedgerEntry = { ...unhashed, hash: computeHash(unhashed) };
    insertLedgerRow(entry);
    return entry;
  });
  return tx.immediate();
}

export const RecordVerdictInputSchema = z.object({
  actor: LedgerActorSchema.default("policy_engine"),
  mandate_id: z.string(),
  action: MoneyActionTypeSchema,
  amount_paise: z.number().int(),
  verdict: VerdictSchema,
  ts: z.string().datetime().optional(),
  id: z.string().min(1).optional(),
});
export type RecordVerdictInput = z.input<typeof RecordVerdictInputSchema>;

/** Writes a policy verdict as-is — ALLOW, COUNTER, GATE and DENY all land in the book. */
export function recordVerdict(input: RecordVerdictInput): LedgerEntry {
  const valid = RecordVerdictInputSchema.parse(input);
  return appendEntry({
    actor: valid.actor,
    mandate_id: valid.mandate_id,
    action: valid.action,
    amount_paise: valid.amount_paise,
    verdict: valid.verdict.decision,
    reason_code: valid.verdict.reason_code,
    human_reason: valid.verdict.human_reason,
    policy_checks: valid.verdict.policy_checks,
    ts: valid.ts,
    id: valid.id,
  });
}

/* ------------------------------------------------------------------ */
/*  Reading & verification                                             */
/* ------------------------------------------------------------------ */

export function listEntries(opts: { limit?: number; order?: "asc" | "desc" } = {}): LedgerEntry[] {
  return listLedgerRows(opts);
}

/** Parses an entry's stored checks; a malformed blob yields [] rather than throwing. */
export function parsePolicyChecks(entry: Pick<LedgerEntry, "policy_checks_json">): PolicyCheck[] {
  try {
    const parsed = PolicyChecksSchema.safeParse(JSON.parse(entry.policy_checks_json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Recomputes every hash in insertion order and checks each row links to the
 * previous one (the first row to GENESIS_HASH). Returns the 0-based index of the
 * first row that fails, or null when the whole chain holds.
 */
export function verifyChain(): number | null {
  const rows = listLedgerRows({ order: "asc" });
  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.prev_hash !== expectedPrev) return i;
    if (computeHash(row) !== row.hash) return i;
    expectedPrev = row.hash;
  }
  return null;
}

export interface ChainSummary {
  count: number;
  /** hash of the newest entry, or GENESIS_HASH when the book is empty */
  head_hash: string;
  intact: boolean;
  broken_at: number | null;
}

export function chainSummary(): ChainSummary {
  const broken_at = verifyChain();
  return {
    count: ledgerCount(),
    head_hash: lastLedgerRow()?.hash ?? GENESIS_HASH,
    intact: broken_at === null,
    broken_at,
  };
}
