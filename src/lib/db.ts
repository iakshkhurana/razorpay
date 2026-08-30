import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  type LedgerEntry,
  type Mandate,
  type Merchant,
  type Offer,
  type Order,
  type OrderStatus,
  OrderStatusSchema,
  type Policy,
  type Sku,
  VerdictSchema,
} from "./schemas";
import { nowIso } from "./utils";

/* ------------------------------------------------------------------ */
/*  Connection                                                         */
/* ------------------------------------------------------------------ */

type Db = Database.Database;

let db: Db | null = null;

export function dbPath(): string {
  return process.env.AGENTGATE_DB_PATH ?? path.join(process.cwd(), "data", "agentgate.db");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS merchant (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT,
  live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policy (
  merchant_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skus (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL,
  image_emoji TEXT NOT NULL DEFAULT '🛍️'
);
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  user_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_ref TEXT NOT NULL,
  spend_cap_paise INTEGER NOT NULL,
  category_scope_json TEXT NOT NULL,
  exp INTEGER NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  spent_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL,
  used_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL,
  upsell_done INTEGER NOT NULL DEFAULT 0,
  messages_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL,
  sku_ids_json TEXT NOT NULL,
  qty INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  list_total_paise INTEGER NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  is_bundle INTEGER NOT NULL DEFAULT 0,
  verdict_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  sku_ids_json TEXT NOT NULL,
  qty INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  list_total_paise INTEGER NOT NULL DEFAULT 0,
  upsell_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  payment_url TEXT,
  payment_ref TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  mandate_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  amount_paise INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  human_reason TEXT NOT NULL,
  policy_checks_json TEXT NOT NULL DEFAULT '[]',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS translations (
  entry_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  report_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const TABLES = [
  "merchant",
  "policy",
  "skus",
  "agents",
  "mandates",
  "used_nonces",
  "sessions",
  "offers",
  "orders",
  "ledger",
  "translations",
  "eval_runs",
  "kv",
];

export function getDb(): Db {
  if (db) return db;
  const file = dbPath();
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Wipe every table (keeps the file). Used by seed, demo:reset and eval. */
export function clearAllTables(): void {
  const d = getDb();
  const tx = d.transaction(() => {
    for (const t of TABLES) d.exec(`DELETE FROM ${t};`);
    d.exec("DELETE FROM sqlite_sequence WHERE name='ledger';");
  });
  tx();
}

/** Delete the database file entirely (WAL + SHM too) and reopen fresh. */
export function resetDatabaseFile(): void {
  closeDb();
  const file = dbPath();
  if (file === ":memory:") {
    getDb();
    return;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${file}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  getDb();
}

/* ------------------------------------------------------------------ */
/*  Row types                                                          */
/* ------------------------------------------------------------------ */

interface MerchantRow {
  id: string;
  name: string;
  source_url: string | null;
  live: number;
  created_at: string;
}

interface SkuRow {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  price_paise: number;
  stock: number;
  tags_json: string;
  category: string;
  image_emoji: string;
}

interface MandateRow {
  id: string;
  agent_id: string;
  user_ref: string;
  spend_cap_paise: number;
  category_scope_json: string;
  exp: number;
  nonce: string;
  token: string;
  spent_paise: number;
  created_at: string;
}

interface OfferRow {
  id: string;
  mandate_id: string;
  sku_ids_json: string;
  qty: number;
  total_paise: number;
  list_total_paise: number;
  discount_pct: number;
  is_bundle: number;
  verdict_json: string;
  created_at: string;
}

interface OrderRow {
  id: string;
  mandate_id: string;
  offer_id: string;
  sku_ids_json: string;
  qty: number;
  amount_paise: number;
  list_total_paise: number;
  upsell_paise: number;
  status: string;
  payment_url: string | null;
  payment_ref: string | null;
  attempts: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRecord {
  id: string;
  mandate_id: string;
  upsell_done: boolean;
  messages_json: string;
  created_at: string;
  updated_at: string;
}

export interface MandateRecord extends Mandate {
  id: string;
  token: string;
  spent_paise: number;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Merchant & policy                                                  */
/* ------------------------------------------------------------------ */

export const DEFAULT_MERCHANT_ID = "merchant_default";

export function getMerchant(): Merchant | null {
  const row = getDb()
    .prepare("SELECT * FROM merchant WHERE id = ?")
    .get(DEFAULT_MERCHANT_ID) as MerchantRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    source_url: row.source_url,
    live: row.live === 1,
    created_at: row.created_at,
  };
}

export function upsertMerchant(input: { name: string; source_url?: string | null; live: boolean }): Merchant {
  const d = getDb();
  const existing = getMerchant();
  const created_at = existing?.created_at ?? nowIso();
  d.prepare(
    `INSERT INTO merchant (id, name, source_url, live, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, source_url = excluded.source_url, live = excluded.live`,
  ).run(DEFAULT_MERCHANT_ID, input.name, input.source_url ?? null, input.live ? 1 : 0, created_at);
  return getMerchant() as Merchant;
}

export function getPolicy(): Policy | null {
  const row = getDb()
    .prepare("SELECT json FROM policy WHERE merchant_id = ?")
    .get(DEFAULT_MERCHANT_ID) as { json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.json) as Policy;
}

export function setPolicy(policy: Policy): void {
  getDb()
    .prepare(
      `INSERT INTO policy (merchant_id, json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(merchant_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    )
    .run(DEFAULT_MERCHANT_ID, JSON.stringify(policy), nowIso());
}

/* ------------------------------------------------------------------ */
/*  SKUs                                                               */
/* ------------------------------------------------------------------ */

function rowToSku(row: SkuRow): Sku {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price_paise: row.price_paise,
    stock: row.stock,
    tags: JSON.parse(row.tags_json) as string[],
    category: row.category,
    image_emoji: row.image_emoji,
  };
}

export function listSkus(): Sku[] {
  const rows = getDb().prepare("SELECT * FROM skus ORDER BY rowid").all() as SkuRow[];
  return rows.map(rowToSku);
}

export function getSku(id: string): Sku | null {
  const row = getDb().prepare("SELECT * FROM skus WHERE id = ?").get(id) as SkuRow | undefined;
  return row ? rowToSku(row) : null;
}

export function replaceCatalog(skus: Sku[]): void {
  const d = getDb();
  const insert = d.prepare(
    `INSERT INTO skus (id, merchant_id, name, description, price_paise, stock, tags_json, category, image_emoji)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = d.transaction((items: Sku[]) => {
    d.exec("DELETE FROM skus;");
    for (const s of items) {
      insert.run(
        s.id,
        DEFAULT_MERCHANT_ID,
        s.name,
        s.description,
        s.price_paise,
        s.stock,
        JSON.stringify(s.tags),
        s.category,
        s.image_emoji,
      );
    }
  });
  tx(skus);
}

export function decrementStock(skuId: string, qty: number): void {
  getDb()
    .prepare("UPDATE skus SET stock = MAX(0, stock - ?) WHERE id = ?")
    .run(qty, skuId);
}

/* ------------------------------------------------------------------ */
/*  Agents & mandates                                                  */
/* ------------------------------------------------------------------ */

export function upsertAgent(agent_id: string, user_ref: string): void {
  getDb()
    .prepare(
      `INSERT INTO agents (agent_id, user_ref, created_at) VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET user_ref = excluded.user_ref`,
    )
    .run(agent_id, user_ref, nowIso());
}

export function listAgents(): Array<{ agent_id: string; user_ref: string; created_at: string }> {
  return getDb().prepare("SELECT * FROM agents ORDER BY created_at DESC").all() as Array<{
    agent_id: string;
    user_ref: string;
    created_at: string;
  }>;
}

function rowToMandate(row: MandateRow): MandateRecord {
  return {
    id: row.id,
    agent_id: row.agent_id,
    user_ref: row.user_ref,
    spend_cap_paise: row.spend_cap_paise,
    category_scope: JSON.parse(row.category_scope_json) as string[],
    exp: row.exp,
    nonce: row.nonce,
    token: row.token,
    spent_paise: row.spent_paise,
    created_at: row.created_at,
  };
}

export function insertMandate(rec: { id: string; token: string } & Mandate): MandateRecord {
  getDb()
    .prepare(
      `INSERT INTO mandates (id, agent_id, user_ref, spend_cap_paise, category_scope_json, exp, nonce, token, spent_paise, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      rec.id,
      rec.agent_id,
      rec.user_ref,
      rec.spend_cap_paise,
      JSON.stringify(rec.category_scope),
      rec.exp,
      rec.nonce,
      rec.token,
      nowIso(),
    );
  return getMandate(rec.id) as MandateRecord;
}

export function getMandate(id: string): MandateRecord | null {
  const row = getDb().prepare("SELECT * FROM mandates WHERE id = ?").get(id) as MandateRow | undefined;
  return row ? rowToMandate(row) : null;
}

export function addMandateSpend(id: string, paise: number): void {
  getDb().prepare("UPDATE mandates SET spent_paise = spent_paise + ? WHERE id = ?").run(paise, id);
}

export function listUsedNonces(): Set<string> {
  const rows = getDb().prepare("SELECT nonce FROM used_nonces").all() as Array<{ nonce: string }>;
  return new Set(rows.map((r) => r.nonce));
}

export function isNonceUsed(nonce: string): boolean {
  const row = getDb().prepare("SELECT 1 FROM used_nonces WHERE nonce = ?").get(nonce);
  return Boolean(row);
}

export function markNonceUsed(nonce: string, mandate_id: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO used_nonces (nonce, mandate_id, used_at) VALUES (?, ?, ?)")
    .run(nonce, mandate_id, nowIso());
}

/* ------------------------------------------------------------------ */
/*  Sessions (negotiation state)                                       */
/* ------------------------------------------------------------------ */

export function getSession(id: string): SessionRecord | null {
  const row = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | { id: string; mandate_id: string; upsell_done: number; messages_json: string; created_at: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return { ...row, upsell_done: row.upsell_done === 1 };
}

export function saveSession(rec: { id: string; mandate_id: string; upsell_done: boolean; messages_json: string }): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, mandate_id, upsell_done, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET upsell_done = excluded.upsell_done, messages_json = excluded.messages_json, updated_at = excluded.updated_at`,
    )
    .run(rec.id, rec.mandate_id, rec.upsell_done ? 1 : 0, rec.messages_json, ts, ts);
}

/* ------------------------------------------------------------------ */
/*  Offers                                                             */
/* ------------------------------------------------------------------ */

function rowToOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    mandate_id: row.mandate_id,
    sku_ids: JSON.parse(row.sku_ids_json) as string[],
    qty: row.qty,
    total_paise: row.total_paise,
    list_total_paise: row.list_total_paise,
    discount_pct: row.discount_pct,
    is_bundle: row.is_bundle === 1,
    verdict: VerdictSchema.parse(JSON.parse(row.verdict_json)),
    created_at: row.created_at,
  };
}

export function insertOffer(offer: Offer): Offer {
  getDb()
    .prepare(
      `INSERT INTO offers (id, mandate_id, sku_ids_json, qty, total_paise, list_total_paise, discount_pct, is_bundle, verdict_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      offer.id,
      offer.mandate_id,
      JSON.stringify(offer.sku_ids),
      offer.qty,
      offer.total_paise,
      offer.list_total_paise,
      offer.discount_pct,
      offer.is_bundle ? 1 : 0,
      JSON.stringify(offer.verdict),
      offer.created_at,
    );
  return offer;
}

export function getOffer(id: string): Offer | null {
  const row = getDb().prepare("SELECT * FROM offers WHERE id = ?").get(id) as OfferRow | undefined;
  return row ? rowToOffer(row) : null;
}

/* ------------------------------------------------------------------ */
/*  Orders                                                             */
/* ------------------------------------------------------------------ */

function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    mandate_id: row.mandate_id,
    offer_id: row.offer_id,
    sku_ids: JSON.parse(row.sku_ids_json) as string[],
    qty: row.qty,
    amount_paise: row.amount_paise,
    list_total_paise: row.list_total_paise,
    upsell_paise: row.upsell_paise,
    status: OrderStatusSchema.parse(row.status),
    payment_url: row.payment_url,
    payment_ref: row.payment_ref,
    attempts: row.attempts,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function idempotencyKey(mandate_id: string, offer_id: string): string {
  return `${mandate_id}:${offer_id}`;
}

export function insertOrder(order: Order): Order {
  getDb()
    .prepare(
      `INSERT INTO orders (id, mandate_id, offer_id, sku_ids_json, qty, amount_paise, list_total_paise, upsell_paise, status, payment_url, payment_ref, attempts, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      order.id,
      order.mandate_id,
      order.offer_id,
      JSON.stringify(order.sku_ids),
      order.qty,
      order.amount_paise,
      order.list_total_paise,
      order.upsell_paise,
      order.status,
      order.payment_url,
      order.payment_ref,
      order.attempts,
      idempotencyKey(order.mandate_id, order.offer_id),
      order.created_at,
      order.updated_at,
    );
  return order;
}

export function getOrder(id: string): Order | null {
  const row = getDb().prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
  return row ? rowToOrder(row) : null;
}

export function getOrderByIdempotencyKey(key: string): Order | null {
  const row = getDb().prepare("SELECT * FROM orders WHERE idempotency_key = ?").get(key) as OrderRow | undefined;
  return row ? rowToOrder(row) : null;
}

export function getOrderByPaymentRef(ref: string): Order | null {
  const row = getDb().prepare("SELECT * FROM orders WHERE payment_ref = ?").get(ref) as OrderRow | undefined;
  return row ? rowToOrder(row) : null;
}

export function updateOrder(
  id: string,
  patch: Partial<Pick<Order, "status" | "payment_url" | "payment_ref" | "attempts">>,
): Order | null {
  const current = getOrder(id);
  if (!current) return null;
  const next = { ...current, ...patch, updated_at: nowIso() };
  getDb()
    .prepare(
      `UPDATE orders SET status = ?, payment_url = ?, payment_ref = ?, attempts = ?, updated_at = ? WHERE id = ?`,
    )
    .run(next.status, next.payment_url, next.payment_ref, next.attempts, next.updated_at, id);
  return next;
}

export function listOrders(filter: { status?: OrderStatus | OrderStatus[] } = {}): Order[] {
  const d = getDb();
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    const placeholders = statuses.map(() => "?").join(",");
    const rows = d
      .prepare(`SELECT * FROM orders WHERE status IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...statuses) as OrderRow[];
    return rows.map(rowToOrder);
  }
  const rows = d.prepare("SELECT * FROM orders ORDER BY created_at DESC").all() as OrderRow[];
  return rows.map(rowToOrder);
}

/* ------------------------------------------------------------------ */
/*  Ledger rows (hashing lives in lib/ledger.ts)                       */
/* ------------------------------------------------------------------ */

export function insertLedgerRow(entry: LedgerEntry): void {
  getDb()
    .prepare(
      `INSERT INTO ledger (id, ts, actor, mandate_id, action, amount_paise, verdict, reason_code, human_reason, policy_checks_json, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id,
      entry.ts,
      entry.actor,
      entry.mandate_id,
      entry.action,
      entry.amount_paise,
      entry.verdict,
      entry.reason_code,
      entry.human_reason,
      entry.policy_checks_json,
      entry.prev_hash,
      entry.hash,
    );
}

export function listLedgerRows(opts: { limit?: number; order?: "asc" | "desc" } = {}): LedgerEntry[] {
  const order = opts.order === "desc" ? "DESC" : "ASC";
  const sql = opts.limit
    ? `SELECT id, ts, actor, mandate_id, action, amount_paise, verdict, reason_code, human_reason, policy_checks_json, prev_hash, hash FROM ledger ORDER BY seq ${order} LIMIT ?`
    : `SELECT id, ts, actor, mandate_id, action, amount_paise, verdict, reason_code, human_reason, policy_checks_json, prev_hash, hash FROM ledger ORDER BY seq ${order}`;
  const stmt = getDb().prepare(sql);
  return (opts.limit ? stmt.all(opts.limit) : stmt.all()) as LedgerEntry[];
}

export function lastLedgerRow(): LedgerEntry | null {
  const row = getDb()
    .prepare(
      "SELECT id, ts, actor, mandate_id, action, amount_paise, verdict, reason_code, human_reason, policy_checks_json, prev_hash, hash FROM ledger ORDER BY seq DESC LIMIT 1",
    )
    .get() as LedgerEntry | undefined;
  return row ?? null;
}

export function ledgerCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM ledger").get() as { n: number };
  return row.n;
}

/** Test/demo helper: mutate a stored row to demonstrate tamper detection. */
export function tamperLedgerRow(id: string, patch: { amount_paise?: number; human_reason?: string }): void {
  const d = getDb();
  if (patch.amount_paise !== undefined) {
    d.prepare("UPDATE ledger SET amount_paise = ? WHERE id = ?").run(patch.amount_paise, id);
  }
  if (patch.human_reason !== undefined) {
    d.prepare("UPDATE ledger SET human_reason = ? WHERE id = ?").run(patch.human_reason, id);
  }
}

/* ------------------------------------------------------------------ */
/*  Translations cache, eval runs, kv                                  */
/* ------------------------------------------------------------------ */

export function getTranslation(entry_id: string): string | null {
  const row = getDb().prepare("SELECT text FROM translations WHERE entry_id = ?").get(entry_id) as
    | { text: string }
    | undefined;
  return row?.text ?? null;
}

export function setTranslation(entry_id: string, text: string): void {
  getDb()
    .prepare(
      `INSERT INTO translations (entry_id, text, created_at) VALUES (?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET text = excluded.text`,
    )
    .run(entry_id, text, nowIso());
}

export function saveEvalRun(id: string, report: unknown): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO eval_runs (id, ts, report_json) VALUES (?, ?, ?)")
    .run(id, nowIso(), JSON.stringify(report));
}

export function latestEvalRun<T = unknown>(): { id: string; ts: string; report: T } | null {
  const row = getDb().prepare("SELECT * FROM eval_runs ORDER BY ts DESC LIMIT 1").get() as
    | { id: string; ts: string; report_json: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, ts: row.ts, report: JSON.parse(row.report_json) as T };
}

export function kvGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
