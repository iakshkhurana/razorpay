import OpenAI from "openai";
import type { z } from "zod";
import { recordLlmCall } from "../metrics";

/**
 * Single entry point for every model call in the product.
 *
 * Nothing here decides money. Callers get text, JSON or a tool-call message back,
 * or `null` — never an exception — and the deterministic fallbacks take over.
 * A failed call opens a circuit breaker for a minute so a flaky network does not
 * stall every turn of a demo behind a timeout.
 */

export const MODELS = { heavy: "gpt-4o", light: "gpt-4o-mini" } as const;
export type ModelTier = keyof typeof MODELS;

export type LlmMode = "openai" | "fallback";

export interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatOptions {
  model: ModelTier;
  system: string;
  messages: ChatTurn[];
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
}

export type ToolDefinition = OpenAI.ChatCompletionTool;

export interface ChatWithToolsOptions {
  model: ModelTier;
  system: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  tools: ToolDefinition[];
  tool_choice?: OpenAI.ChatCompletionToolChoiceOption;
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
}

const PLACEHOLDER_KEY = "sk-...";
const BREAKER_OPEN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;

let clock: () => number = () => Date.now();
let breakerOpenUntil = 0;
let client: OpenAI | null = null;
let clientKey = "";

function apiKey(): string {
  return (process.env.OPENAI_API_KEY ?? "").trim();
}

export function hasOpenAI(): boolean {
  const key = apiKey();
  return key.length > 0 && key !== PLACEHOLDER_KEY;
}

export function getOpenAI(): OpenAI {
  if (!hasOpenAI()) {
    throw new Error("OPENAI_API_KEY is not configured; check llmMode() before calling getOpenAI()");
  }
  const key = apiKey();
  if (!client || clientKey !== key) {
    client = new OpenAI({ apiKey: key, maxRetries: 1 });
    clientKey = key;
  }
  return client;
}

export function llmMode(): LlmMode {
  if (!hasOpenAI()) return "fallback";
  return clock() < breakerOpenUntil ? "fallback" : "openai";
}

/** Park every caller on the fallback path for a minute after a model/network error. */
export function tripBreaker(cause?: unknown): void {
  breakerOpenUntil = clock() + BREAKER_OPEN_MS;
  const detail = cause instanceof Error ? cause.message : String(cause ?? "unknown error");
  console.warn(`[llm] OpenAI call failed (${detail}); using fallback for ${BREAKER_OPEN_MS / 1000}s`);
}

export function _setClock(fn: () => number): void {
  clock = fn;
}

export function _resetBreaker(): void {
  breakerOpenUntil = 0;
}

function buildParams(opts: ChatOptions): OpenAI.ChatCompletionCreateParamsNonStreaming {
  return {
    model: MODELS[opts.model],
    temperature: opts.temperature ?? 0,
    ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
  };
}

async function complete(
  params: OpenAI.ChatCompletionCreateParamsNonStreaming,
  timeoutMs: number,
): Promise<OpenAI.ChatCompletionMessage | null> {
  if (llmMode() !== "openai") return null;
  const started = Date.now();
  try {
    const res = await getOpenAI().chat.completions.create(params, { timeout: timeoutMs });
    recordLlmCall({
      model: params.model,
      duration_ms: Date.now() - started,
      prompt_tokens: res.usage?.prompt_tokens ?? 0,
      completion_tokens: res.usage?.completion_tokens ?? 0,
    });
    return res.choices[0]?.message ?? null;
  } catch (err) {
    tripBreaker(err);
    return null;
  }
}

export async function chatText(opts: ChatOptions): Promise<string | null> {
  const message = await complete(buildParams(opts), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const text = message?.content?.trim();
  return text ? text : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * JSON-mode call validated by the caller's schema. The schema's output must be an
 * object (OpenAI's json_object mode never returns a bare array).
 */
export async function chatJson<T>(
  opts: ChatOptions & { schema: z.ZodType<T, z.ZodTypeDef, unknown> },
): Promise<T | null> {
  const system = /json/i.test(opts.system) ? opts.system : `${opts.system}\nRespond with a single JSON object.`;
  const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    ...buildParams({ ...opts, system }),
    response_format: { type: "json_object" },
  };
  const message = await complete(params, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!message?.content) return null;
  const raw = parseJson(message.content);
  if (raw === undefined) return null;
  const result = opts.schema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Function-calling round trip for the seller agent; the caller runs the tools. */
export async function chatWithTools(opts: ChatWithToolsOptions): Promise<OpenAI.ChatCompletionMessage | null> {
  const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model: MODELS[opts.model],
    temperature: opts.temperature ?? 0,
    ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
    tools: opts.tools,
    ...(opts.tool_choice !== undefined ? { tool_choice: opts.tool_choice } : {}),
  };
  return complete(params, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}
