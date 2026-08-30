/**
 * Live verification with real keys: the OpenAI seller path and a Razorpay
 * test-mode Payment Link. Runs in-process against a throwaway database.
 *   npx tsx scripts/verify-live.ts
 */
process.env.AGENTGATE_DB_PATH = ":memory:";
process.env.AGENTGATE_EMBEDDINGS = process.env.AGENTGATE_EMBEDDINGS ?? "off";

async function main() {
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());

  const { seedDatabase } = await import("../src/lib/seed");
  const { issueMandate, verifyMandateToken } = await import("../src/lib/mandate");
  const { loadSession, sellerTurn } = await import("../src/lib/llm/seller");
  const { llmMode, hasOpenAI } = await import("../src/lib/llm/router");
  const { recordMandateIssued, checkout } = await import("../src/lib/storefront");
  const { formatINR } = await import("../src/lib/money");

  seedDatabase({ quiet: true });
  console.log(`OpenAI key present: ${hasOpenAI()} · llm mode: ${llmMode()}`);

  const now = Math.floor(Date.now() / 1000);
  const issued = issueMandate({ agent_id: "buyer-agent-live", user_ref: "priya@example.com", spend_cap_paise: 200_000, category_scope: ["handloom", "gifts"], ttl_seconds: 3600, now });
  const verified = verifyMandateToken(issued.token, now);
  if (!verified.ok) throw new Error(verified.error);
  recordMandateIssued(verified.claims);

  let session = loadSession(undefined, verified.claims.mandate_id);
  const t1 = await sellerTurn({ session, mandate: verified.claims, message: "anniversary gift for mom, budget ₹2000", now });
  console.log(`[${t1.mode}] seller: ${t1.reply}`);
  console.log(`  events: ${t1.events.map((e) => `${e.action}:${e.verdict.decision}:${formatINR(e.amount_paise)}`).join(", ") || "none"}`);
  session = t1.session;
  const t2 = await sellerTurn({ session, mandate: verified.claims, message: "Yes, that works — I'll take it.", now });
  console.log(`[${t2.mode}] seller: ${t2.reply}`);
  console.log(`  events: ${t2.events.map((e) => `${e.action}:${e.verdict.decision}:${formatINR(e.amount_paise)}`).join(", ") || "none"}`);
  let order = t2.order;
  if (!order && t1.offer) {
    const co = await checkout({ mandate: verified.claims, offer_id: t1.offer.id, now });
    order = co.ok ? co.order : null;
  }
  console.log(`  order: ${order ? `${order.status} · ${formatINR(order.amount_paise)} · link ${order.payment_url}` : "none"}`);

  const { paymentsMode, RazorpayPaymentPort } = await import("../src/lib/payments");
  console.log(`payments mode: ${paymentsMode()} (PAYMENTS_MODE=${process.env.PAYMENTS_MODE})`);

  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    const port = new RazorpayPaymentPort();
    const handle = await port.createOrder({
      order_id: `verify_${Date.now().toString(36)}`,
      amount_paise: 184_900,
      description: "AgentGate live check: Cotton Handloom Saree + Matching Blouse Piece",
      idempotency_key: `verify:${Date.now().toString(36)}`,
      customer: { name: "Priya (test)", email: "priya@example.com" },
    });
    console.log(`razorpay test link: ${handle.payment_url} (${handle.payment_ref})`);
    console.log(`razorpay status now: ${await port.fetchStatus(handle.payment_ref)}`);
  } else {
    console.log("razorpay keys absent — skipped the live Payment Link check");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("verify-live failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
