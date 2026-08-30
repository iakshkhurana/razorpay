import { beforeEach, describe, expect, it } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";
process.env.AGENTGATE_EMBEDDINGS = "off";
process.env.PAYMENTS_MODE = "mock";
process.env.APP_URL = "http://localhost:3000";
delete process.env.OPENAI_API_KEY;

import fs from "node:fs";
import path from "node:path";
import { clearAllTables } from "@/lib/db";
import { issueMandate as issueMandateDirect } from "@/lib/mandate";
import { POST as checkout } from "./agent/checkout/route";
import { GET as discover } from "./agent/discover/route";
import { POST as negotiate } from "./agent/negotiate/route";
import { GET as catalog } from "./catalog/route";
import { POST as simulateWebhook } from "./dev/simulate-webhook/route";
import { GET as ledger } from "./ledger/route";
import { POST as issueMandate } from "./mandate/issue/route";
import { POST as onboard } from "./onboard/route";
import { GET as orders, POST as decide } from "./orders/route";
import { POST as confirmPolicy } from "./policy/confirm/route";
import { GET as buyerGoals, POST as buyerTurn } from "./simulator/buyer/route";
import { GET as stats } from "./stats/route";

const seedCsv = fs.readFileSync(path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv"), "utf8");

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000${url}`, { headers });
}

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function goLive(): Promise<void> {
  const draft = await body<{ merchant_name: string; skus: unknown[]; policy: unknown }>(await onboard(post("/api/onboard", { csv: seedCsv, merchant_name: "Ramesh Handlooms" })));
  const res = await confirmPolicy(post("/api/policy/confirm", { merchant_name: draft.merchant_name, skus: draft.skus, policy: draft.policy }));
  expect(res.status).toBe(200);
}

async function mandate(cap_paise: number): Promise<string> {
  const res = await issueMandate(post("/api/mandate/issue", { spend_cap_paise: cap_paise, category_scope: ["handloom", "gifts"] }));
  expect(res.status).toBe(200);
  return (await body<{ token: string }>(res)).token;
}

interface NegotiateResponse {
  session_id: string;
  reply: string;
  events: Array<{ action: string; verdict: { decision: string; reason_code: string; counter?: { max_total_paise: number } }; amount_paise: number; offer_id?: string }>;
  offer: { id: string } | null;
  order: { id: string; status: string; payment_url: string | null; payment_ref: string | null } | null;
  mode: string;
}

async function say(token: string, message: string, session_id?: string): Promise<NegotiateResponse> {
  const res = await negotiate(post("/api/agent/negotiate", { mandate_token: token, message, session_id }));
  expect(res.status).toBe(200);
  return body<NegotiateResponse>(res);
}

beforeEach(async () => {
  clearAllTables();
  await goLive();
});

describe("onboarding", () => {
  it("drafts a catalog and policy from CSV, applies a Hinglish voice patch, and goes live", async () => {
    const res = await onboard(post("/api/onboard", { csv: seedCsv, voice_utterance: "minimum price 90% se kam mat karna" }));
    const draft = await body<{ skus: unknown[]; policy: { price_floor_pct: number; category_allowlist: string[] }; source: string; voice: { spoken_confirmation: string } }>(res);
    expect(draft.skus).toHaveLength(8);
    expect(draft.source).toBe("csv");
    expect(draft.policy.price_floor_pct).toBe(90);
    expect(draft.policy.category_allowlist).not.toContain("footwear");
    expect(draft.voice.spoken_confirmation).toMatch(/90/);

    const shop = await body<{ merchant: { live: boolean; name: string }; skus: unknown[] }>(await catalog());
    expect(shop.merchant.live).toBe(true);
    expect(shop.skus).toHaveLength(8);
  });

  it("rejects a body with neither URL nor CSV", async () => {
    const res = await onboard(post("/api/onboard", { merchant_name: "x" }));
    expect(res.status).toBe(422);
  });

  it("rejects malformed JSON", async () => {
    const res = await onboard(post("/api/onboard", "{not json"));
    expect(res.status).toBe(400);
  });
});

describe("discover", () => {
  it("returns ranked, scope-marked results and the public policy", async () => {
    const token = await mandate(200_000);
    const res = await discover(get("/api/agent/discover?q=jutti", { authorization: `Bearer ${token}` }));
    const data = await body<{ results: Array<{ sku: { name: string }; sellable: boolean }>; policy: { category_allowlist: string[] } }>(res);
    expect(data.results[0].sku.name).toBe("Punjabi Jutti Gold");
    expect(data.results[0].sellable).toBe(false);
    expect(data.policy.category_allowlist).toEqual(["handloom", "gifts"]);
  });
});

describe("flow 1 over HTTP — happy path with upsell", () => {
  it("negotiate → ALLOW ₹1,849 → checkout → mock success → PAID, stats and ledger agree", async () => {
    const token = await mandate(200_000);
    const first = await say(token, "anniversary gift for mom, budget ₹2000");
    expect(first.events[0].verdict.decision).toBe("ALLOW");
    expect(first.events[0].amount_paise).toBe(184900);
    expect(first.mode).toBe("fallback");

    const co = await checkout(post("/api/agent/checkout", { mandate_token: token, offer_id: first.offer?.id }));
    expect(co.status).toBe(200);
    const placed = await body<{ order: { id: string; status: string }; payment_url: string }>(co);
    expect(placed.order.status).toBe("AWAITING_PAYMENT");
    expect(placed.payment_url).toContain("/dev/mock-pay?order=");

    const paid = await simulateWebhook(post("/api/dev/simulate-webhook", { order_id: placed.order.id, outcome: "success" }));
    expect((await body<{ order: { status: string } }>(paid)).order.status).toBe("PAID");

    const s = await body<{ stats: { revenue_paise: number; upsell_paise: number; ledger_intact: boolean }; modes: { llm: string; payments: string } }>(await stats());
    expect(s.stats.revenue_paise).toBe(184900);
    expect(s.stats.upsell_paise).toBe(35000);
    expect(s.stats.ledger_intact).toBe(true);
    expect(s.modes).toMatchObject({ llm: "fallback", payments: "mock", search: "keyword" });

    const book = await body<{ entries: Array<{ verdict: string; plain: string | null }>; chain: { intact: boolean; count: number } }>(await ledger(get("/api/ledger?view=shopkeeper")));
    expect(book.chain.intact).toBe(true);
    expect(book.chain.count).toBeGreaterThanOrEqual(6);
    expect(book.entries[0].verdict).toBe("PAID");
    expect(book.entries.every((e) => typeof e.plain === "string" && e.plain.length > 0)).toBe(true);
  });

  it("the same offer cannot be checked out twice into two orders", async () => {
    const token = await mandate(200_000);
    const first = await say(token, "cotton saree");
    const a = await body<{ order: { id: string } }>(await checkout(post("/api/agent/checkout", { mandate_token: token, offer_id: first.offer?.id })));
    const b = await body<{ order: { id: string }; duplicate: boolean }>(await checkout(post("/api/agent/checkout", { mandate_token: token, offer_id: first.offer?.id })));
    expect(b.order.id).toBe(a.order.id);
    expect(b.duplicate).toBe(true);
  });
});

describe("flow 2 over HTTP — bounded and gated", () => {
  it("jutti DENY → 2 Banarasis COUNTER → Banarasi + stole GATE → owner approves → PAID", async () => {
    const token = await mandate(800_000);
    const t1 = await say(token, "Do you have golden juttis for a wedding?");
    expect(t1.events[0].verdict.reason_code).toBe("CATEGORY_OUT_OF_SCOPE");

    const t2 = await say(token, "Okay then, I'd like 2 Banarasi sarees for the wedding.", t1.session_id);
    expect(t2.events[0].verdict.reason_code).toBe("SPEND_CAP_EXCEEDED");
    expect(t2.events[0].verdict.counter?.max_total_paise).toBe(800000);

    const t3 = await say(token, "Okay, I'll go with your counter offer.", t2.session_id);
    expect(t3.events[0].verdict.reason_code).toBe("HIGH_VALUE_REVIEW");
    expect(t3.events[0].amount_paise).toBe(564800);

    const t4 = await say(token, "Yes, go ahead.", t3.session_id);
    expect(t4.order?.status).toBe("PENDING_APPROVAL");

    const queue = await body<{ orders: Array<{ id: string; sku_names: string[] }> }>(await orders(get("/api/orders?status=PENDING_APPROVAL")));
    expect(queue.orders).toHaveLength(1);
    expect(queue.orders[0].sku_names).toEqual(["Banarasi Silk Saree", "Handwoven Stole"]);

    const approved = await body<{ order: { status: string; payment_url: string } }>(await decide(post("/api/orders", { order_id: queue.orders[0].id, decision: "approve" })));
    expect(approved.order.status).toBe("AWAITING_PAYMENT");
    expect(approved.order.payment_url).toContain("/dev/mock-pay");

    const paid = await body<{ order: { status: string } }>(await simulateWebhook(post("/api/dev/simulate-webhook", { order_id: queue.orders[0].id, outcome: "success" })));
    expect(paid.order.status).toBe("PAID");

    const again = await decide(post("/api/orders", { order_id: queue.orders[0].id, decision: "reject" }));
    expect(again.status).toBe(409);
  });

  it("an over-cap checkout is refused with a 409 and a COUNTER verdict", async () => {
    const token = await mandate(200_000);
    const t = await say(token, "I want a banarasi silk saree");
    expect(t.events[0].verdict.decision).toBe("COUNTER");
    const res = await checkout(post("/api/agent/checkout", { mandate_token: token, offer_id: t.offer?.id }));
    expect(res.status).toBe(409);
    expect((await body<{ verdict: { decision: string } }>(res)).verdict.decision).toBe("COUNTER");
  });
});

describe("flow 3 over HTTP — graceful failure", () => {
  it("failure webhook → HELD → backup link → success → PAID", async () => {
    const token = await mandate(200_000);
    const t = await say(token, "anniversary gift for mom, budget ₹2000");
    const placed = await body<{ order: { id: string } }>(await checkout(post("/api/agent/checkout", { mandate_token: token, offer_id: t.offer?.id })));

    const failed = await body<{ order: { status: string; attempts: number; payment_url: string; held_recovering: boolean } }>(
      await simulateWebhook(post("/api/dev/simulate-webhook", { order_id: placed.order.id, outcome: "failure" })),
    );
    expect(failed.order.status).toBe("AWAITING_PAYMENT");
    expect(failed.order.attempts).toBe(2);
    expect(failed.order.held_recovering).toBe(true);
    expect(failed.order.payment_url).toContain("retry=2");

    const one = await body<{ order: { held_recovering: boolean } }>(await orders(get(`/api/orders?id=${placed.order.id}`)));
    expect(one.order.held_recovering).toBe(true);

    const paid = await body<{ order: { status: string } }>(await simulateWebhook(post("/api/dev/simulate-webhook", { order_id: placed.order.id, outcome: "success" })));
    expect(paid.order.status).toBe("PAID");

    const book = await body<{ entries: Array<{ verdict: string }> }>(await ledger(get("/api/ledger?limit=4")));
    expect(book.entries.map((e) => e.verdict)).toEqual(["PAID", "INFO", "HELD", "FAILED"]);
  });

  it("a webhook for an unknown order is a 404 and a malformed one a 400", async () => {
    expect((await simulateWebhook(post("/api/dev/simulate-webhook", { order_id: "ghost", outcome: "success" }))).status).toBe(404);
    expect((await simulateWebhook(post("/api/dev/simulate-webhook", { order_id: "x", outcome: "maybe" }))).status).toBe(400);
  });
});

describe("mandate enforcement at the edge", () => {
  it("a forged token is refused with 401 and the refusal is in the book", async () => {
    const token = await mandate(200_000);
    const forged = `${token.slice(0, -4)}abcd`;
    const res = await negotiate(post("/api/agent/negotiate", { mandate_token: forged, message: "hello" }));
    expect(res.status).toBe(401);
    const book = await body<{ entries: Array<{ verdict: string; reason_code: string }> }>(await ledger(get("/api/ledger?limit=1")));
    expect(book.entries[0].verdict).toBe("DENY");
    expect(book.entries[0].reason_code).toBe("MANDATE_INVALID_SIGNATURE");
  });

  it("an expired mandate is refused with MANDATE_EXPIRED", async () => {
    const { token } = issueMandateDirect({ agent_id: "buyer-agent-demo", user_ref: "priya@example.com", spend_cap_paise: 200_000, category_scope: ["handloom"], ttl_seconds: 1, now: 1_700_000_000 });
    const refused = await negotiate(post("/api/agent/negotiate", { mandate_token: token, message: "hello" }));
    expect(refused.status).toBe(401);
    expect((await body<{ verdict: { reason_code: string } }>(refused)).verdict.reason_code).toBe("MANDATE_EXPIRED");
  });

  it("a checkout with a mandate that is not the offer's is denied", async () => {
    const a = await mandate(200_000);
    const b = await mandate(200_000);
    const t = await say(a, "cotton saree");
    const res = await checkout(post("/api/agent/checkout", { mandate_token: b, offer_id: t.offer?.id }));
    expect(res.status).toBe(409);
  });
});

describe("simulator buyer", () => {
  it("lists the three demo goals and produces an opening line", async () => {
    const goals = await body<{ goals: Array<{ key: string; cap_paise: number }> }>(await buyerGoals());
    expect(goals.goals.map((g) => g.key)).toEqual(["gift", "wedding", "failure"]);
    const turn = await body<{ message: string; done: boolean; mode: string }>(await buyerTurn(post("/api/simulator/buyer", { goal_key: "gift" })));
    expect(turn.done).toBe(false);
    expect(turn.message).toMatch(/gift/i);
    expect(turn.mode).toBe("fallback");
  });
});
