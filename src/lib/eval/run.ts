import path from "node:path";
import { dbPath, ledgerCount, listOrders, listSkus, replaceCatalog, resetDatabaseFile, saveEvalRun, setPolicy } from "../db";
import { newId } from "../ids";
import { listEntries, parsePolicyChecks, verifyChain } from "../ledger";
import { scriptedBuyerNext, type BuyerState, type DemoGoal } from "../llm/buyer";
import { llmMode } from "../llm/router";
import { loadSession, persistSession, sellerTurn, type SessionState } from "../llm/seller";
import { issueMandate, verifyMandateToken } from "../mandate";
import { paymentsMode } from "../payments";
import type { MandateClaims, Order, Policy, Sku, VerdictEvent } from "../schemas";
import { keywordScore, searchMode, warmSearch } from "../search";
import { seedDatabase } from "../seed";
import {
  activePolicy,
  applyPaymentEvent,
  checkout,
  makeOffer,
  merchantName,
  ownerDecision,
  recordMandateIssued,
  recordShopLive,
} from "../storefront";
import { ATTACKS, CONTROLS, SKU, breachReasons, type Attack, type ControlSession } from "./attacks";
import { INTENTS, type Intent } from "./intents";
import { MUTATIONS, selftestVerdict, type MutationOutcome } from "./selftest";
import {
  ATTACK_CATEGORIES,
  EVAL_CAVEAT,
  EvalReportSchema,
  heroLine,
  type AttackCategory,
  type AttackCategoryResult,
  type EvalReport,
  type StoreResult,
} from "./types";

/**
 * The evidence harness. Drives the real storefront, seller agent, policy
 * engine, ledger and mock payments in-process against a dedicated database:
 * 100 buyer intents through a static baseline and through AgentGate, 40
 * scripted attacks, 20 legit controls, then a coverage audit of the book.
 *
 * Deterministic by construction: PAYMENTS_MODE is forced to mock, the model is
 * off unless asked for, every session gets a fixed `now`, and the only
 * randomness that can touch an outcome is a seeded PRNG (ids and nonces are
 * random but never influence a verdict).
 */

export const DEFAULT_SEED = 1729;
/** unix seconds; every session runs at NOW_BASE + a fixed offset */
export const NOW_BASE = 1_800_000_000;
const EVAL_AGENT = "eval-buyer-agent";
const EVAL_USER = "eval-buyer@example.com";
const MAX_LOOP = 8;
const MODEL_WARM_TIMEOUT_MS = 30_000;

export interface RunEvalOptions {
  seed?: number;
  log?: (line: string) => void;
  /** run only the first N intents / attacks / controls (tests) */
  intentLimit?: number;
  attackLimit?: number;
  controlLimit?: number;
  attackFilter?: (attack: Attack) => boolean;
  /** keep OPENAI_API_KEY in play; off by default so reruns are comparable */
  useLlm?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Seeded PRNG                                                        */
/* ------------------------------------------------------------------ */

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Guards & setup                                                     */
/* ------------------------------------------------------------------ */

function assertEvalDatabase(): void {
  const configured = process.env.AGENTGATE_DB_PATH;
  // NTFS paths are case-insensitive; compare accordingly so "k:\..." cannot slip past the guard.
  const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const appDb = norm(path.join(process.cwd(), "data", "agentgate.db"));
  if (!configured || norm(dbPath()) === appDb) {
    throw new Error(
      "Refusing to run the eval against the app database. Set AGENTGATE_DB_PATH to a dedicated file (npm run eval does) or ':memory:'.",
    );
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mintMandate(input: { cap_paise: number; scope: string[]; issuedAt: number; ttl_seconds?: number }): MandateClaims {
  const { token } = issueMandate({
    agent_id: EVAL_AGENT,
    user_ref: EVAL_USER,
    spend_cap_paise: input.cap_paise,
    category_scope: input.scope,
    ttl_seconds: input.ttl_seconds ?? 3600,
    now: input.issuedAt,
  });
  const verified = verifyMandateToken(token, input.issuedAt);
  if (!verified.ok) throw new Error(`eval: a freshly issued mandate failed verification (${verified.error})`);
  recordMandateIssued(verified.claims);
  return verified.claims;
}

async function capture(order: Order): Promise<Order> {
  const result = await applyPaymentEvent({
    type: "captured",
    payment_ref: order.payment_ref ?? "",
    order_id: order.id,
    amount_paise: null,
    raw_event: "mock.success",
  });
  return result.ok ? result.order : order;
}

/* ------------------------------------------------------------------ */
/*  Conversations                                                      */
/* ------------------------------------------------------------------ */

interface Conversation {
  events: VerdictEvent[];
  order: Order | null;
}

/** The scripted buyer against the real seller until the buyer is done or the turn limit hits. */
async function converse(goal: DemoGoal, mandate: MandateClaims, now: number): Promise<Conversation> {
  let session: SessionState = loadSession(undefined, mandate.mandate_id);
  const state: BuyerState = { goal, transcript: [], last_events: [], turn: 0, order_placed: false };
  const events: VerdictEvent[] = [];
  let order: Order | null = null;

  for (let i = 0; i < MAX_LOOP; i += 1) {
    const next = scriptedBuyerNext(state);
    if (next.done || !next.message) break;
    state.transcript.push({ role: "buyer", content: next.message });
    const result = await sellerTurn({ session, mandate, message: next.message, now });
    session = result.session;
    state.transcript.push({ role: "seller", content: result.reply });
    state.last_events = result.events;
    events.push(...result.events);
    if (result.order) {
      order = result.order;
      state.order_placed = true;
    }
    state.turn += 1;
  }
  return { events, order };
}

/* ------------------------------------------------------------------ */
/*  Benchmark                                                          */
/* ------------------------------------------------------------------ */

export interface BaselineSale {
  sku: Sku;
  amount_paise: number;
}

/**
 * The static store: keyword search over the catalog, list price, no seller,
 * no bundles. The buyer takes the top in-stock hit when it is in scope and
 * within budget; otherwise nothing is sold.
 */
export function baselineSale(intent: Intent, catalog: Sku[], policy: Policy): BaselineSale | null {
  const allowed = new Set(policy.category_allowlist.map((c) => c.toLowerCase()));
  const scope = new Set(intent.scope.map((c) => c.toLowerCase()));
  const hits = catalog
    .filter((s) => s.stock > 0)
    .map((sku) => ({ sku, score: keywordScore(intent.text, sku) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.sku.price_paise - b.sku.price_paise || a.sku.id.localeCompare(b.sku.id));
  const top = hits[0];
  if (!top) return null;
  const cat = top.sku.category.toLowerCase();
  if (!allowed.has(cat) || !scope.has(cat)) return null;
  if (top.sku.price_paise > intent.budget_paise) return null;
  return { sku: top.sku, amount_paise: top.sku.price_paise };
}

interface Sale {
  amount_paise: number;
  upsell_paise: number;
}

function storeResult(sessions: number, sales: Sale[]): StoreResult {
  const revenue = sales.reduce((acc, s) => acc + s.amount_paise, 0);
  const upsell = sales.reduce((acc, s) => acc + s.upsell_paise, 0);
  return {
    sessions,
    orders: sales.length,
    conversion_pct: sessions > 0 ? round1((sales.length / sessions) * 100) : 0,
    revenue_paise: revenue,
    avg_order_paise: sales.length > 0 ? Math.round(revenue / sales.length) : 0,
    upsell_paise: upsell,
    upsell_pct: revenue > 0 ? round1((upsell / revenue) * 100) : 0,
    bundles: sales.filter((s) => s.upsell_paise > 0).length,
  };
}

async function agentgateSession(intent: Intent, now: number): Promise<Sale | null> {
  const mandate = mintMandate({ cap_paise: intent.budget_paise, scope: intent.scope, issuedAt: now });
  const goal: DemoGoal = {
    key: "gift",
    label: intent.id,
    goal: intent.text,
    cap_paise: intent.budget_paise,
    scope: intent.scope,
    script: [intent.text],
  };
  const c = await converse(goal, mandate, now);
  let order = c.order;
  if (order?.status === "PENDING_APPROVAL") {
    const decided = await ownerDecision(order.id, "approve");
    if (decided.ok) order = decided.order;
  }
  if (order?.status === "AWAITING_PAYMENT") order = await capture(order);
  if (order?.status !== "PAID") return null;
  return { amount_paise: order.amount_paise, upsell_paise: order.upsell_paise };
}

/* ------------------------------------------------------------------ */
/*  Red team                                                           */
/* ------------------------------------------------------------------ */

interface AttackOutcome {
  attack: Attack;
  reason_codes: string[];
  caught: boolean;
  primary_code: string | null;
  breaches: string[];
  /** largest single out-of-policy amount this attack got refused */
  refused_paise: number;
  /** largest single amount this attack sent to the owner instead of the agent */
  gated_paise: number;
}

async function runAttack(attack: Attack, now: number, policy: Policy, catalog: Sku[]): Promise<AttackOutcome> {
  const expired = attack.setup === "expired";
  const mandate = mintMandate({
    cap_paise: attack.cap_paise,
    scope: attack.scope,
    issuedAt: expired ? now - 100 : now,
    ttl_seconds: expired ? 1 : 3600,
  });

  let session = loadSession(undefined, mandate.mandate_id);
  let setupOrderId: string | null = null;
  if (attack.setup === "replay") {
    const legit = makeOffer({ mandate, sku_ids: [SKU.SAREE], qty: 1, actor: "seller_agent", now });
    const placed = await checkout({ mandate, offer_id: legit.offer.id, now });
    if (placed.ok) {
      const paid = await capture(placed.order);
      setupOrderId = paid.id;
    }
    session = { ...session, last_offer_id: legit.offer.id, anchor_sku_id: SKU.SAREE };
    persistSession(session);
  }

  const ledgerStart = ledgerCount();

  for (const line of attack.lines) {
    const result = await sellerTurn({ session, mandate, message: line, now });
    session = result.session;
  }
  if (attack.direct) {
    const offered = makeOffer({
      mandate,
      sku_ids: attack.direct.sku_ids,
      qty: attack.direct.qty,
      discount_pct: attack.direct.discount_pct,
      proposed_total_paise: attack.direct.proposed_total_paise,
      actor: "buyer_agent",
      now,
    });
    await checkout({ mandate, offer_id: offered.offer.id, now });
  }

  const rows = listEntries().slice(ledgerStart).filter((e) => e.action !== "mandate.issued");
  const reason_codes = rows.map((e) => e.reason_code);
  const expected = new Set(attack.expected_reason_codes);
  const primary_code = reason_codes.find((code) => expected.has(code)) ?? null;

  const orders = listOrders().filter((o) => o.mandate_id === mandate.mandate_id && o.id !== setupOrderId);
  const breaches = orders.flatMap((o) => {
    const reasons = breachReasons(o, attack, policy, mandate, { catalog, now, setup_order_id: setupOrderId });
    return reasons.length > 0 ? [`${o.id} ${o.status} ${o.amount_paise}p: ${reasons.join(", ")}`] : [];
  });

  // One adversary, one attempt: take the biggest amount the gate turned away rather
  // than summing every counter it wrote along the way.
  const biggest = (verdicts: readonly string[]) =>
    rows.filter((e) => verdicts.includes(e.verdict)).reduce((max, e) => Math.max(max, e.amount_paise), 0);

  return {
    attack,
    reason_codes,
    caught: primary_code !== null && breaches.length === 0,
    primary_code,
    breaches,
    refused_paise: biggest(["DENY", "COUNTER"]),
    gated_paise: biggest(["GATE"]),
  };
}

/**
 * Per-rule catch rate: attacks grouped by the reason code they were written to
 * trip (the first expected code), each value the share of that group that was
 * caught. 100 everywhere means every rule fired when it should have.
 */
function catchRateByReason(outcomes: AttackOutcome[]): Record<string, number> {
  const tally = new Map<string, { attempted: number; caught: number }>();
  for (const o of outcomes) {
    const code = o.attack.expected_reason_codes[0];
    const t = tally.get(code) ?? { attempted: 0, caught: 0 };
    t.attempted += 1;
    if (o.caught) t.caught += 1;
    tally.set(code, t);
  }
  const out: Record<string, number> = {};
  for (const [code, t] of tally) out[code] = round1((t.caught / t.attempted) * 100);
  return out;
}

async function runControl(control: ControlSession, now: number): Promise<{ blocked: boolean; codes: string[] }> {
  const mandate = mintMandate({ cap_paise: control.cap_paise, scope: control.scope, issuedAt: now });
  const goal: DemoGoal = {
    key: "gift",
    label: control.id,
    goal: control.lines[0] ?? "",
    cap_paise: control.cap_paise,
    scope: control.scope,
    script: [...control.lines],
  };
  const c = await converse(goal, mandate, now);
  const allowed = c.events.some((e) => e.verdict.decision === "ALLOW");
  const denied = c.events.some((e) => e.verdict.decision === "DENY");
  return { blocked: !allowed || denied, codes: c.events.map((e) => e.verdict.reason_code) };
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export async function runEval(opts: RunEvalOptions = {}): Promise<EvalReport> {
  assertEvalDatabase();
  const log = opts.log ?? (() => undefined);
  const seed = opts.seed ?? DEFAULT_SEED;
  const rand = mulberry32(seed);
  const started = Date.now();

  const savedPaymentsMode = process.env.PAYMENTS_MODE;
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.PAYMENTS_MODE = "mock";
  if (!opts.useLlm) process.env.OPENAI_API_KEY = "";

  try {
    resetDatabaseFile();
    const { skuCount } = seedDatabase({ quiet: true });
    recordShopLive(merchantName(), skuCount);
    const search = await warmSearch({ loadTimeoutMs: MODEL_WARM_TIMEOUT_MS });
    const pristine = listSkus();
    const policy = activePolicy();
    const resetCatalog = () => replaceCatalog(pristine);
    log(`eval: db=${dbPath()} · seed ${seed} · llm=${llmMode()} · payments=${paymentsMode()} · search=${search}`);

    /* Benchmark ------------------------------------------------------ */
    const intents = shuffled(INTENTS.slice(0, opts.intentLimit ?? INTENTS.length), rand);
    const baselineSales: Sale[] = [];
    const agentSales: Sale[] = [];
    let noHit = 0;
    for (const intent of intents) {
      const index = INTENTS.indexOf(intent);
      const now = NOW_BASE + index;
      resetCatalog();
      const base = baselineSale(intent, pristine, policy);
      if (base) baselineSales.push({ amount_paise: base.amount_paise, upsell_paise: 0 });
      const sale = await agentgateSession(intent, now);
      if (sale) agentSales.push(sale);
      if (!base && !sale) noHit += 1;
    }
    const baseline = storeResult(intents.length, baselineSales);
    const agentgate = storeResult(intents.length, agentSales);
    log(
      `benchmark: ${intents.length} intents · baseline ${baseline.orders} orders / ${baseline.revenue_paise}p · agentgate ${agentgate.orders} orders / ${agentgate.revenue_paise}p · ${noHit} sold by neither`,
    );

    /* Red team -------------------------------------------------------- */
    let attacks = ATTACKS.filter(opts.attackFilter ?? (() => true));
    attacks = attacks.slice(0, opts.attackLimit ?? attacks.length);
    const outcomes: AttackOutcome[] = [];
    for (const attack of shuffled(attacks, rand)) {
      const now = NOW_BASE + 1000 + ATTACKS.indexOf(attack);
      resetCatalog();
      const outcome = await runAttack(attack, now, policy, pristine);
      outcomes.push(outcome);
      const tag = outcome.breaches.length > 0 ? "BREACH" : outcome.caught ? "caught" : "missed";
      log(`attack ${attack.id} (${attack.category}): ${tag} — ${outcome.reason_codes.join(", ") || "no verdicts"}${outcome.breaches.length > 0 ? ` · ${outcome.breaches.join("; ")}` : ""}`);
    }

    const by_category: AttackCategoryResult[] = ATTACK_CATEGORIES.map((category: AttackCategory) => {
      const mine = outcomes.filter((o) => o.attack.category === category);
      const reason_codes: Record<string, number> = {};
      for (const o of mine) for (const code of o.reason_codes) reason_codes[code] = (reason_codes[code] ?? 0) + 1;
      return {
        category,
        attempted: mine.length,
        caught: mine.filter((o) => o.caught).length,
        breaches: mine.reduce((acc, o) => acc + o.breaches.length, 0),
        reason_codes,
      };
    });
    const breaches = by_category.reduce((acc, c) => acc + c.breaches, 0);
    const caught = outcomes.filter((o) => o.caught).length;
    const catch_rate_by_reason = catchRateByReason(outcomes);

    /* Controls -------------------------------------------------------- */
    const controls = CONTROLS.slice(0, opts.controlLimit ?? CONTROLS.length);
    let control_blocked = 0;
    for (const control of controls) {
      const now = NOW_BASE + 2000 + CONTROLS.indexOf(control);
      resetCatalog();
      const result = await runControl(control, now);
      if (result.blocked) {
        control_blocked += 1;
        log(`control ${control.id} blocked — ${result.codes.join(", ") || "no verdicts"}`);
      }
    }
    log(`red team: ${attacks.length} attacks · ${caught} caught · ${breaches} breaches · controls ${control_blocked}/${controls.length} blocked`);

    /* Coverage -------------------------------------------------------- */
    const entries = listEntries();
    const money = entries.filter((e) => e.action !== "mandate.issued" && e.action !== "shop.live");
    const withReason = money.filter((e) => e.human_reason.trim().length > 0).length;
    const withCheck = money.filter((e) => parsePolicyChecks(e).length > 0).length;
    const with_human_reason_pct = money.length > 0 ? round1((withReason / money.length) * 100) : 0;
    const with_policy_check_pct = money.length > 0 ? round1((withCheck / money.length) * 100) : 0;
    const chain_intact = verifyChain() === null;
    log(`coverage: ${money.length} money actions · ${with_human_reason_pct}% explained · ${with_policy_check_pct}% checked · chain ${chain_intact ? "intact" : "BROKEN"}`);

    /* Harness self-test ------------------------------------------------ */
    const mutationOutcomes: MutationOutcome[] = [];
    for (const mutation of MUTATIONS) {
      const original = ATTACKS.find((a) => a.id === mutation.attack_id);
      if (!original) continue;
      const attack = mutation.mutateAttack ? mutation.mutateAttack(original) : original;
      resetCatalog();
      setPolicy(mutation.mutate(policy));
      try {
        // sabotaged engine, but breaches are still judged against the real rulebook
        const outcome = await runAttack(attack, NOW_BASE + 3000 + mutationOutcomes.length, policy, pristine);
        mutationOutcomes.push({
          id: mutation.id,
          label: mutation.label,
          attack_id: mutation.attack_id,
          detected: outcome.breaches.length > 0,
          breaches: outcome.breaches,
        });
      } finally {
        setPolicy(policy);
      }
    }
    const selftest = selftestVerdict(mutationOutcomes);
    for (const m of mutationOutcomes) {
      log(`self-test ${m.id} (${m.label}): ${m.detected ? "breach seen — detector works" : "NOT DETECTED — harness is blind"}`);
    }
    log(`self-test: ${selftest.detected}/${mutationOutcomes.length} injected breaches detected · harness ${selftest.sound ? "sound" : "UNSOUND"}`);

    /* Report ---------------------------------------------------------- */
    const uplift = {
      revenue_paise: agentgate.revenue_paise - baseline.revenue_paise,
      revenue_pct:
        baseline.revenue_paise > 0
          ? round1(((agentgate.revenue_paise - baseline.revenue_paise) / baseline.revenue_paise) * 100)
          : agentgate.revenue_paise > 0
            ? 100
            : 0,
      conversion_pts: round1(agentgate.conversion_pct - baseline.conversion_pct),
    };
    const ran_at = new Date().toISOString();
    const headline = {
      breaches,
      attacks: attacks.length,
      explained_pct: Math.min(with_human_reason_pct, with_policy_check_pct),
      revenue_uplift_pct: uplift.revenue_pct,
      ran_at,
    };

    const report = EvalReportSchema.parse({
      version: 1,
      ran_at,
      seed,
      duration_ms: Date.now() - started,
      modes: { llm: llmMode(), payments: paymentsMode(), search: searchMode() },
      benchmark: { intents: intents.length, baseline, agentgate, uplift },
      red_team: {
        attacks: attacks.length,
        breaches,
        caught,
        by_category,
        catch_rate_by_reason,
        control_sessions: controls.length,
        control_blocked,
        false_block_rate_pct: controls.length > 0 ? round1((control_blocked / controls.length) * 100) : 0,
      },
      coverage: {
        money_actions: money.length,
        with_human_reason_pct,
        with_policy_check_pct,
        chain_intact,
        ledger_entries: entries.length,
      },
      harness_check: {
        mutations: mutationOutcomes.length,
        detected: selftest.detected,
        sound: selftest.sound,
        detail: mutationOutcomes,
      },
      economics: {
        refused_paise: outcomes.reduce((acc, o) => acc + o.refused_paise, 0),
        gated_paise: outcomes.reduce((acc, o) => acc + o.gated_paise, 0),
        earned_paise: agentgate.revenue_paise,
        false_block_paise: control_blocked * agentgate.avg_order_paise,
      },
      headline,
      hero_line: heroLine(headline),
      caveat: EVAL_CAVEAT,
    } satisfies EvalReport);

    saveEvalRun(newId("eval"), report);
    return report;
  } finally {
    restoreEnv("OPENAI_API_KEY", savedKey);
    restoreEnv("PAYMENTS_MODE", savedPaymentsMode);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
