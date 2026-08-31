/**
 * In-process request metrics for the demo dashboard. A small ring buffer —
 * no database, no external service; it resets with the server process,
 * which is exactly right for a demo (`/metrics` says so). Costs are
 * estimates from published per-token prices, labeled as estimates.
 */

export interface LlmCall {
  model: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ToolCall {
  name: string;
  duration_ms: number;
}

export interface TurnMetric {
  id: number;
  ts: string;
  route: string;
  duration_ms: number;
  lang?: string;
  mode?: string;
  llm_calls: LlmCall[];
  tools: ToolCall[];
  /** synth/transcribe duration for voice routes */
  voice_ms?: number;
  chars?: number;
  ok: boolean;
}

const CAPACITY = 60;

/**
 * Next bundles every route separately, so plain module state would give each
 * route its own copy. The store lives on globalThis so the negotiate route,
 * the voice routes and /api/metrics all see the same buffer.
 */
interface MetricsStore {
  buffer: TurnMetric[];
  seq: number;
  active: ActiveTrace | null;
}

const globalStore = globalThis as typeof globalThis & { __agentgateMetrics?: MetricsStore };
const store: MetricsStore = (globalStore.__agentgateMetrics ??= { buffer: [], seq: 0, active: null });

/** USD per 1M tokens (input, output) — published list prices; estimates only. */
const PRICE_PER_M: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
};
const USD_TO_INR = 88;

export function estimateCostPaise(calls: LlmCall[]): number {
  let usd = 0;
  for (const c of calls) {
    const [inP, outP] = PRICE_PER_M[c.model] ?? [0, 0];
    usd += (c.prompt_tokens / 1_000_000) * inP + (c.completion_tokens / 1_000_000) * outP;
  }
  return Math.round(usd * USD_TO_INR * 100);
}

/* ------------------------------------------------------------------ */
/*  Active turn trace                                                  */
/*  One trace at a time: negotiate turns run one-per-request in the    */
/*  demo. Under real concurrency attribution could interleave — a      */
/*  documented demo trade-off, not a correctness path.                 */
/* ------------------------------------------------------------------ */

export function beginTurn(route: string, lang?: string): void {
  store.active = { route, started: Date.now(), lang, llm_calls: [], tools: [] };
}

/** Called by the LLM router on every completion; attributed to the active turn or logged standalone. */
export function recordLlmCall(call: LlmCall): void {
  if (store.active) store.active.llm_calls.push(call);
  else push({ route: "llm", duration_ms: call.duration_ms, llm_calls: [call], tools: [], ok: true });
}

export function recordToolCall(name: string, duration_ms: number): void {
  store.active?.tools.push({ name, duration_ms });
}

export function endTurn(extra: { mode?: string; ok?: boolean } = {}): void {
  if (!store.active) return;
  const t = store.active;
  store.active = null;
  push({
    route: t.route,
    duration_ms: Date.now() - t.started,
    lang: t.lang,
    mode: extra.mode,
    llm_calls: t.llm_calls,
    tools: t.tools,
    ok: extra.ok ?? true,
  });
}

/** One-shot record for voice routes (tts/stt) and anything without a trace. */
export function recordVoiceCall(route: "tts" | "stt", duration_ms: number, ok: boolean, chars?: number): void {
  push({ route, duration_ms, llm_calls: [], tools: [], voice_ms: duration_ms, chars, ok });
}

function push(m: Omit<TurnMetric, "id" | "ts">): void {
  store.seq += 1;
  store.buffer.push({ id: store.seq, ts: new Date().toISOString(), ...m });
  if (store.buffer.length > CAPACITY) store.buffer.shift();
}

export function listMetrics(): TurnMetric[] {
  return [...store.buffer].reverse();
}

interface ActiveTrace {
  route: string;
  started: number;
  lang?: string;
  llm_calls: LlmCall[];
  tools: ToolCall[];
}

export interface MetricsSummary {
  turns: number;
  avg_turn_ms: number | null;
  avg_first_llm_ms: number | null;
  avg_tts_ms: number | null;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  est_cost_paise: number;
}

export function summarizeMetrics(): MetricsSummary {
  const turns = store.buffer.filter((m) => m.route === "negotiate");
  const tts = store.buffer.filter((m) => m.route === "tts" && m.ok);
  const allCalls = store.buffer.flatMap((m) => m.llm_calls);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    turns: turns.length,
    avg_turn_ms: avg(turns.map((m) => m.duration_ms)),
    avg_first_llm_ms: avg(turns.map((m) => m.llm_calls[0]?.duration_ms).filter((n): n is number => typeof n === "number")),
    avg_tts_ms: avg(tts.map((m) => m.duration_ms)),
    total_prompt_tokens: allCalls.reduce((a, c) => a + c.prompt_tokens, 0),
    total_completion_tokens: allCalls.reduce((a, c) => a + c.completion_tokens, 0),
    est_cost_paise: estimateCostPaise(allCalls),
  };
}

/** Test helper. */
export function _resetMetrics(): void {
  store.buffer.length = 0;
  store.seq = 0;
  store.active = null;
}
