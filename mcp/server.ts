/**
 * AgentGate MCP server (M10).
 *
 * A stdio server exposing three tools that proxy the AgentGate HTTP API. Every tool
 * is a thin HTTP call: the merchant's policy engine and the hash-chained ledger sit
 * behind the API, so nothing here can price, discount or pay on its own.
 *
 * Run: `npm run mcp` (or `npx tsx mcp/server.ts`). Base URL from AGENTGATE_URL.
 * stdout is the protocol channel — every log line goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatINR } from "../src/lib/money";

const BASE_URL = (process.env.AGENTGATE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SERVER_VERSION = "0.1.0";

function log(...parts: unknown[]): void {
  console.error("[agentgate-mcp]", ...parts);
}

/* ------------------------------------------------------------------ */
/*  HTTP proxy                                                          */
/* ------------------------------------------------------------------ */

type HttpResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number | null; message: string; body: unknown };

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return `AgentGate answered HTTP ${status}.`;
}

async function callApi(path: string, init: RequestInit): Promise<HttpResult> {
  const url = `${BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: null,
      message: `Could not reach AgentGate at ${BASE_URL} (${detail}). Start the app with "npm run dev" or point AGENTGATE_URL at a running instance.`,
      body: null,
    };
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: errorMessage(body, res.status), body };
  }
  return { ok: true, status: res.status, body };
}

function get(path: string, token?: string): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return callApi(path, { method: "GET", headers });
}

function post(path: string, payload: unknown): Promise<HttpResult> {
  return callApi(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
}

/* ------------------------------------------------------------------ */
/*  Tool results                                                        */
/* ------------------------------------------------------------------ */

function textResult(value: unknown, isError = false): CallToolResult {
  const result: CallToolResult = { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  if (isError) result.isError = true;
  return result;
}

function failure(result: Extract<HttpResult, { ok: false }>): CallToolResult {
  const response = result.body && typeof result.body === "object" ? { response: result.body } : {};
  return textResult({ error: result.message, status: result.status, ...response }, true);
}

/** Reads a field off an unknown JSON body without asserting its shape. */
function field(body: unknown, key: string): unknown {
  if (body && typeof body === "object" && key in body) return (body as Record<string, unknown>)[key];
  return undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rupees(paise: unknown): string | null {
  const n = asNumber(paise);
  return n === null ? null : formatINR(n);
}

/* ------------------------------------------------------------------ */
/*  Response shaping (narrow the API bodies to what a buyer needs)      */
/* ------------------------------------------------------------------ */

const DiscoverResultSchema = z.object({
  sku: z.object({
    id: z.string(),
    name: z.string(),
    price_paise: z.number(),
    category: z.string(),
    stock: z.number().optional(),
    description: z.string().optional(),
  }),
  sellable: z.boolean(),
  score: z.number().optional(),
});

const VerdictSchema = z.object({
  decision: z.string(),
  reason_code: z.string(),
  human_reason: z.string(),
  counter: z.object({ max_total_paise: z.number(), suggestion: z.string() }).optional(),
  policy_checks: z.array(z.object({ rule: z.string(), result: z.string(), detail: z.string() })).optional(),
});

function shapeVerdict(raw: unknown) {
  const parsed = VerdictSchema.safeParse(raw);
  if (!parsed.success) return raw ?? null;
  const v = parsed.data;
  return {
    decision: v.decision,
    reason_code: v.reason_code,
    human_reason: v.human_reason,
    ...(v.counter
      ? { counter: { max_total: formatINR(v.counter.max_total_paise), max_total_paise: v.counter.max_total_paise, suggestion: v.counter.suggestion } }
      : {}),
    ...(v.policy_checks ? { policy_checks: v.policy_checks } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*  Server                                                              */
/* ------------------------------------------------------------------ */

const GUARANTEE =
  "Every call goes through AgentGate's HTTP API: the merchant's deterministic policy engine verdicts each money action (ALLOW, COUNTER, GATE or DENY) and writes it to the hash-chained ledger. This tool never bypasses that path.";

const server = new McpServer(
  { name: "agentgate", version: SERVER_VERSION },
  {
    instructions:
      "AgentGate lets an AI buyer shop from a small Indian merchant under a signed mandate. " +
      "Flow: agentgate_search to find SKUs, agentgate_offer to price a basket and get the policy verdict, " +
      "agentgate_checkout (only when the verdict is ALLOW or GATE) to create the order and payment link. " +
      "Amounts are integer paise; formatted rupee strings are provided alongside. " +
      GUARANTEE,
  },
);

server.registerTool(
  "agentgate_search",
  {
    title: "Search the merchant's catalog",
    description:
      "Find products by natural-language query. Read-only: nothing is priced or bought here. Results carry the list price and whether the SKU is sellable " +
      "under the merchant's category allowlist and, when a mandate_token is given, the mandate's scope. " +
      GUARANTEE,
    inputSchema: {
      query: z.string().min(1).describe("What the buyer is looking for, e.g. 'anniversary gift saree'."),
      k: z.number().int().min(1).max(20).optional().describe("How many results to return (1-20, default 8)."),
      mandate_token: z.string().optional().describe("Signed mandate JWT; narrows results to the mandate's category scope."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ query, k, mandate_token }) => {
    const params = new URLSearchParams({ q: query, k: String(k ?? 8) });
    const result = await get(`/api/agent/discover?${params.toString()}`, mandate_token);
    if (!result.ok) return failure(result);

    const rawResults = field(result.body, "results");
    const results = Array.isArray(rawResults)
      ? rawResults.map((item) => {
          const parsed = DiscoverResultSchema.safeParse(item);
          if (!parsed.success) return item;
          const { sku, sellable } = parsed.data;
          return {
            name: sku.name,
            sku_id: sku.id,
            price: formatINR(sku.price_paise),
            price_paise: sku.price_paise,
            sellable,
            category: sku.category,
            ...(sku.stock !== undefined ? { stock: sku.stock } : {}),
            ...(sku.description ? { description: sku.description } : {}),
          };
        })
      : [];

    return textResult({
      merchant: field(result.body, "merchant") ?? null,
      query,
      mandate_scope: field(result.body, "mandate_scope") ?? null,
      category_allowlist: field(field(result.body, "policy"), "category_allowlist") ?? null,
      results,
    });
  },
);

server.registerTool(
  "agentgate_offer",
  {
    title: "Price a basket and get the policy verdict",
    description:
      "Propose a basket (SKU ids, quantity, optional discount) under a mandate. Returns an offer_id plus the verdict: " +
      "ALLOW means you may check out; COUNTER carries the maximum total the policy accepts; GATE means the shop owner must approve; DENY explains why not. " +
      GUARANTEE,
    inputSchema: {
      mandate_token: z.string().min(1).describe("Signed mandate JWT from AgentGate (POST /api/mandate/issue)."),
      sku_ids: z.array(z.string().min(1)).min(1).max(20).describe("SKU ids from agentgate_search."),
      qty: z.number().int().min(1).max(1000).optional().describe("Quantity applied to each SKU (default 1)."),
      discount_pct: z.number().min(0).max(100).optional().describe("Discount off list price you are asking for (default 0)."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ mandate_token, sku_ids, qty, discount_pct }) => {
    const result = await post("/api/agent/offer", {
      mandate_token,
      sku_ids,
      qty: qty ?? 1,
      discount_pct: discount_pct ?? 0,
    });
    if (!result.ok) return failure(result);

    const offer = field(result.body, "offer");
    return textResult({
      offer_id: field(offer, "id") ?? null,
      sku_ids: field(offer, "sku_ids") ?? sku_ids,
      qty: field(offer, "qty") ?? qty ?? 1,
      total: rupees(field(offer, "total_paise")),
      total_paise: asNumber(field(offer, "total_paise")),
      list_total: rupees(field(offer, "list_total_paise")),
      list_total_paise: asNumber(field(offer, "list_total_paise")),
      verdict: shapeVerdict(field(result.body, "verdict")),
      ledger_entry_id: field(result.body, "ledger_entry_id") ?? null,
    });
  },
);

server.registerTool(
  "agentgate_checkout",
  {
    title: "Check out an offer",
    description:
      "Turn an ALLOW offer into an order and a payment link. The engine re-checks the offer as a checkout action: " +
      "ALLOW issues the payment link; GATE parks the order for the owner (status PENDING_APPROVAL); COUNTER or DENY refuses and is returned as content with the reason. " +
      "Idempotent on mandate + offer: repeating the call returns the same order. " +
      GUARANTEE,
    inputSchema: {
      mandate_token: z.string().min(1).describe("The same signed mandate JWT used for the offer."),
      offer_id: z.string().min(1).describe("offer_id returned by agentgate_offer."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ mandate_token, offer_id }) => {
    const result = await post("/api/agent/checkout", { mandate_token, offer_id });

    // A refused checkout (409) is a verdict, not a transport failure: hand it back as content.
    if (!result.ok && result.status !== 409) return failure(result);

    const body = result.body;
    const order = field(body, "order");
    const status = field(order, "status");
    return textResult({
      ok: field(body, "ok") === true,
      status: typeof status === "string" ? status : "REFUSED",
      order_id: field(order, "id") ?? null,
      amount: rupees(field(order, "amount_paise")),
      amount_paise: asNumber(field(order, "amount_paise")),
      payment_url: field(body, "payment_url") ?? field(order, "payment_url") ?? null,
      duplicate: field(body, "duplicate") === true,
      verdict: shapeVerdict(field(body, "verdict")),
      ledger_entry_id: field(body, "ledger_entry_id") ?? null,
    });
  },
);

/* ------------------------------------------------------------------ */
/*  Boot                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  // The transport itself does not watch for EOF; leave cleanly when the client closes the pipe.
  process.stdin.once("end", () => {
    log("stdin closed — exiting.");
    void server.close().finally(() => process.exit(0));
  });
  await server.connect(transport);
  log(`ready — proxying ${BASE_URL} (tools: agentgate_search, agentgate_offer, agentgate_checkout)`);
}

main().catch((err: unknown) => {
  log("failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
