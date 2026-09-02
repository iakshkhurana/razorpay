import { json } from "@/lib/api";
import { getMerchant, listSkus } from "@/lib/db";
import { appBaseUrl } from "@/lib/payments";
import { paymentsMode } from "@/lib/payments";
import { activePolicy } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/**
 * The shop, described for a machine.
 *
 * An AI buyer should be able to learn the rules before it spends a turn asking:
 * which categories are sellable, how big an order may be, above what amount a
 * human decides, how to get a mandate, and what each verdict means. Everything
 * here is derived from the live rulebook, so the manifest cannot drift from what
 * the engine actually enforces.
 *
 * Deliberately withheld: the price floor and the maximum discount. Those are the
 * merchant's negotiating position, not a published rule — the engine enforces
 * them, and an agent that pushes past them gets a COUNTER with the best price
 * the shop can do. Publishing them would simply tell every buyer where to start.
 */

const VERDICTS = [
  { decision: "ALLOW", meaning: "Inside every rule. This action may proceed to payment." },
  { decision: "COUNTER", meaning: "Refused, with the best in-policy alternative attached as `counter`." },
  { decision: "GATE", meaning: "Held for the shop owner to decide. No agent can approve it." },
  { decision: "DENY", meaning: "Refused outright, with the rule that refused it." },
] as const;

export async function GET() {
  const merchant = getMerchant();
  const policy = activePolicy();
  const skus = listSkus();
  const base = appBaseUrl();
  const sellable = new Set(policy.category_allowlist.map((c) => c.trim().toLowerCase()));

  return json({
    protocol: "agentgate/1",
    merchant: merchant ? { name: merchant.name, live: merchant.live } : null,
    summary:
      "A small Indian merchant, open to AI buyers. Every money action is checked by a deterministic policy engine and written to a hash-chained ledger before this API answers.",

    auth: {
      scheme: "mandate",
      description:
        "Present a signed mandate on every money action. It carries the buyer's spend cap, the categories it may shop in, an expiry and a single-use nonce; a mandate pays once.",
      algorithm: "HS256 JWT",
      issue: `${base}/api/mandate/issue`,
      send_as: ["body field `mandate_token`", "header `Authorization: Bearer <token>`"],
      claims: ["agent_id", "user_ref", "spend_cap_paise", "category_scope", "exp", "nonce"],
    },

    endpoints: {
      discover: { method: "GET", url: `${base}/api/agent/discover`, note: "Search the catalog. A mandate narrows results to its scope." },
      offer: { method: "POST", url: `${base}/api/agent/offer`, note: "Name a basket, get a stamped verdict and a priced offer." },
      negotiate: { method: "POST", url: `${base}/api/agent/negotiate`, note: "Talk to the seller agent in English or Hindi." },
      checkout: { method: "POST", url: `${base}/api/agent/checkout`, note: "Turn an ALLOW offer into an order and a payment link." },
      ledger: { method: "GET", url: `${base}/api/ledger`, note: "Read the book. Every verdict about you is in it." },
    },

    rules: {
      currency: "INR",
      amounts: "integer paise",
      sellable_categories: policy.category_allowlist,
      max_items_per_order: policy.max_qty_per_order,
      max_order_value_paise: policy.max_order_value_paise,
      owner_decides_above_paise: policy.gate_above_paise,
      refund_policy: policy.refund_policy,
      withheld: ["price_floor_pct", "max_discount_pct"],
      withheld_note:
        "Negotiating limits are enforced but not published. Push past them and you get a COUNTER carrying the best price this shop can do.",
    },

    verdicts: VERDICTS,

    catalog: {
      products: skus.length,
      sellable_products: skus.filter((s) => sellable.has(s.category.trim().toLowerCase())).length,
      categories: [...new Set(skus.map((s) => s.category))].sort(),
    },

    payments: {
      mode: paymentsMode(),
      rails: "test",
      note: "Test-mode rails only; no real money moves. Checkout is idempotent on mandate + offer.",
    },

    guarantees: [
      "No language model can allow, price or execute a money action; verdicts come from a pure deterministic engine.",
      "Every money action — including every refusal and every failure — is appended to a hash-chained ledger.",
      "A refused mandate is written down before the refusal is returned.",
      "Orders above the owner's threshold wait for a human.",
    ],

    limits: {
      negotiate_per_minute: 30,
      note: "Per client. Exceeding a limit returns 429 with a retry-after header.",
    },
  });
}
