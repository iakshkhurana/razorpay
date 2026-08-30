"use client";

import type { ChatMessage, Order, Policy, Sku, Verdict, VerdictEvent } from "../schemas";

/**
 * Typed browser client for the AgentGate API. Every page talks to the server
 * through these helpers so request and response shapes live in one place.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/* ------------------------------------------------------------------ */
/*  Shapes                                                             */
/* ------------------------------------------------------------------ */

export interface OrderView extends Order {
  sku_names: string[];
  held_recovering: boolean;
}

export interface MandateView {
  id: string;
  agent_id: string;
  user_ref: string;
  spend_cap_paise: number;
  category_scope: string[];
  exp: number;
  cap: string;
  scope: string;
  expires_at: string;
  expires_in_seconds: number;
}

export interface IssueMandateResponse {
  ok: true;
  token: string;
  mandate: MandateView;
  ledger_entry_id: string;
}

export interface NegotiateResponse {
  ok: true;
  session_id: string;
  reply: string;
  events: VerdictEvent[];
  offer: { id: string; sku_ids: string[]; qty: number; total_paise: number; is_bundle: boolean; verdict: Verdict } | null;
  order: Order | null;
  mode: "openai" | "fallback";
  upsell_done: boolean;
  injection_signals: string[];
}

export interface CheckoutResponse {
  ok: boolean;
  verdict: Verdict;
  order: OrderView | null;
  payment_url?: string | null;
  duplicate?: boolean;
  ledger_entry_id: string;
}

export interface LedgerEntryView {
  id: string;
  ts: string;
  actor: string;
  mandate_id: string;
  action: string;
  amount_paise: number;
  verdict: string;
  reason_code: string;
  human_reason: string;
  policy_checks: Array<{ rule: string; result: "pass" | "fail" | "skip"; detail: string }>;
  prev_hash: string;
  hash: string;
  plain: string | null;
}

export interface LedgerResponse {
  ok: true;
  view: "tech" | "shopkeeper";
  chain: { count: number; head_hash: string; intact: boolean; broken_at: number | null };
  entries: LedgerEntryView[];
}

export interface StatsResponse {
  ok: true;
  merchant: { name: string; live: boolean } | null;
  stats: {
    revenue_paise: number;
    upsell_paise: number;
    upsell_pct: number;
    orders_paid: number;
    actions_guarded: number;
    ledger_count: number;
    ledger_intact: boolean;
    ledger_broken_at: number | null;
    head_hash: string;
    pending_approvals: number;
    held_orders: number;
  };
  eval: { breaches: number; attacks: number; explained_pct: number; revenue_uplift_pct: number; ran_at: string } | null;
  modes: { llm: "openai" | "fallback"; payments: "mock" | "razorpay"; search: string };
}

export interface OnboardResponse {
  ok: true;
  merchant_name: string;
  skus: Sku[];
  policy: Policy;
  source: "csv" | "url" | "llm" | "fallback";
  llm_mode: "openai" | "fallback";
  voice: { patch: Partial<Policy>; spoken_confirmation: string; source: string } | null;
}

export interface DemoGoalView {
  key: "gift" | "wedding" | "failure";
  label: string;
  goal: string;
  cap_paise: number;
  scope: string[];
}

export interface BuyerTurnResponse {
  ok: true;
  message: string | null;
  done: boolean;
  reason: string;
  mode: "openai" | "fallback";
}

/* ------------------------------------------------------------------ */
/*  Calls                                                              */
/* ------------------------------------------------------------------ */

export const api = {
  stats: () => call<StatsResponse>("/api/stats"),
  ledger: (view: "tech" | "shopkeeper", limit = 100) => call<LedgerResponse>(`/api/ledger?view=${view}&limit=${limit}`),
  catalog: () => call<{ ok: true; merchant: { name: string; live: boolean } | null; skus: Sku[]; policy: Policy }>("/api/catalog"),

  onboard: (body: { url?: string; csv?: string; merchant_name?: string; voice_utterance?: string }) => post<OnboardResponse>("/api/onboard", body),
  confirmPolicy: (body: { merchant_name: string; skus: Sku[]; policy: Policy }) =>
    post<{ ok: true; merchant: { name: string; live: boolean }; sku_count: number }>("/api/policy/confirm", body),

  issueMandate: (body: { spend_cap_paise: number; category_scope?: string[]; agent_id?: string; user_ref?: string; ttl_seconds?: number }) =>
    post<IssueMandateResponse>("/api/mandate/issue", body),
  negotiate: (body: { mandate_token: string; message: string; session_id?: string }) => post<NegotiateResponse>("/api/agent/negotiate", body),
  checkout: async (body: { mandate_token: string; offer_id: string }): Promise<CheckoutResponse> => {
    try {
      return await post<CheckoutResponse>("/api/agent/checkout", body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.body === "object" && err.body !== null && "verdict" in err.body) {
        return err.body as CheckoutResponse;
      }
      throw err;
    }
  },

  orders: (status?: string) => call<{ ok: true; orders: OrderView[] }>(status ? `/api/orders?status=${status}` : "/api/orders"),
  order: (id: string) => call<{ ok: true; order: OrderView }>(`/api/orders?id=${encodeURIComponent(id)}`),
  decide: (body: { order_id: string; decision: "approve" | "reject" }) => post<{ ok: true; order: OrderView }>("/api/orders", body),
  simulateWebhook: (body: { order_id: string; outcome: "success" | "failure" }) =>
    post<{ ok: true; duplicate: boolean; order: OrderView }>("/api/dev/simulate-webhook", body),

  demoGoals: () => call<{ ok: true; goals: DemoGoalView[] }>("/api/simulator/buyer"),
  buyerNext: (body: { goal_key: DemoGoalView["key"]; transcript: ChatMessage[]; last_events: VerdictEvent[]; turn: number; order_placed: boolean }) =>
    post<BuyerTurnResponse>("/api/simulator/buyer", body),
};

/* ------------------------------------------------------------------ */
/*  Scripted sequences shared by the simulator, dashboard and tour     */
/* ------------------------------------------------------------------ */

export interface ScriptedOrderResult {
  token: string;
  mandate: MandateView;
  session_id: string;
  transcript: ChatMessage[];
  events: VerdictEvent[];
  order: Order | null;
}

/**
 * Runs a fixed buyer script against the seller until an order exists or the
 * lines run out. Used by the tour to stage a gated order and a failing payment.
 */
export async function runScriptedOrder(input: {
  cap_paise: number;
  lines: string[];
  category_scope?: string[];
  onTurn?: (turn: { buyer: string; reply: string; events: VerdictEvent[] }) => void;
}): Promise<ScriptedOrderResult> {
  const issued = await api.issueMandate({ spend_cap_paise: input.cap_paise, category_scope: input.category_scope ?? ["handloom", "gifts"] });
  const transcript: ChatMessage[] = [];
  const events: VerdictEvent[] = [];
  let session_id: string | undefined;
  let order: Order | null = null;

  for (const line of input.lines) {
    const res = await api.negotiate({ mandate_token: issued.token, message: line, session_id });
    session_id = res.session_id;
    transcript.push({ role: "buyer", content: line }, { role: "seller", content: res.reply });
    events.push(...res.events);
    input.onTurn?.({ buyer: line, reply: res.reply, events: res.events });
    if (res.order) {
      order = res.order;
      break;
    }
  }

  return { token: issued.token, mandate: issued.mandate, session_id: session_id ?? "", transcript, events, order };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Polls an order until it reaches one of the wanted statuses or the timeout passes. */
export async function waitForOrder(id: string, statuses: string[], timeoutMs = 15_000): Promise<OrderView | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { order } = await api.order(id);
    if (statuses.includes(order.status)) return order;
    await sleep(1000);
  }
  return null;
}
