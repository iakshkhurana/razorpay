"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/demo/client";
import { useLocale, useT } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

const dict = {
  en: {
    title: "Developers",
    subtitle: "Every endpoint is verdicted by the policy engine and written to the ledger. Build a buyer agent in an afternoon.",
    tryTitle: "Try it: mint a test mandate",
    tryBody: "Creates a signed mandate for a demo buyer (₹2,000, handloom + gifts). Use the token as a Bearer header or in request bodies.",
    tryButton: "Issue test mandate",
    tryBusy: "Issuing…",
    tryError: "Could not reach the shop. Check that the app is running.",
    token: "Mandate token",
    copy: "Copy",
    copied: "Copied",
    request: "Request",
    response: "Response",
    mcpTitle: "MCP tools",
    mcpBody: "Three tools that proxy this API for Claude Desktop and other MCP clients — search, offer, checkout. They never bypass the engine.",
    webhookTitle: "Razorpay webhooks",
    webhookBody: "Point a test-mode webhook at /api/webhook/razorpay for payment_link.paid and payment.failed with your RAZORPAY_WEBHOOK_SECRET. Without a public URL the app reconciles awaiting orders from Razorpay's own record on every poll.",
    guarantee: "Path is always request → mandate verify → policy engine → (ALLOW only) payment adapter. The model never touches money.",
  },
  hi: {
    title: "डेवलपर्स",
    subtitle: "हर एंडपॉइंट पॉलिसी इंजन से गुज़रता है और खाते में लिखा जाता है। एक दोपहर में खरीदार एजेंट बनाइए।",
    tryTitle: "आज़माइए: टेस्ट मैंडेट बनाइए",
    tryBody: "डेमो खरीदार के लिए हस्ताक्षरित मैंडेट बनता है (₹2,000, हैंडलूम + गिफ़्ट)। टोकन को Bearer हेडर या रिक्वेस्ट बॉडी में इस्तेमाल करें।",
    tryButton: "टेस्ट मैंडेट जारी करें",
    tryBusy: "जारी हो रहा है…",
    tryError: "दुकान से संपर्क नहीं हो सका। देखें कि ऐप चल रहा है।",
    token: "मैंडेट टोकन",
    copy: "कॉपी",
    copied: "कॉपी हो गया",
    request: "रिक्वेस्ट",
    response: "रिस्पॉन्स",
    mcpTitle: "MCP टूल",
    mcpBody: "तीन टूल जो इसी API को Claude Desktop और दूसरे MCP क्लाइंट के लिए आगे बढ़ाते हैं — खोज, ऑफ़र, चेकआउट। ये इंजन को कभी बायपास नहीं करते।",
    webhookTitle: "Razorpay वेबहुक",
    webhookBody: "टेस्ट-मोड वेबहुक को /api/webhook/razorpay पर payment_link.paid और payment.failed के लिए अपने RAZORPAY_WEBHOOK_SECRET के साथ सेट करें। सार्वजनिक URL न हो तो ऐप हर पोल पर Razorpay के रिकॉर्ड से ऑर्डर मिलाता है।",
    guarantee: "रास्ता हमेशा यही है: रिक्वेस्ट → मैंडेट जाँच → पॉलिसी इंजन → (सिर्फ़ ALLOW पर) भुगतान अडैप्टर। मॉडल कभी पैसे को नहीं छूता।",
  },
};

interface Endpoint {
  method: "GET" | "POST";
  path: string;
  purpose: { en: string; hi: string };
  request?: string;
  response: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: "POST",
    path: "/api/mandate/issue",
    purpose: { en: "Mint a signed buyer mandate (demo helper).", hi: "हस्ताक्षरित खरीदार मैंडेट बनाएँ (डेमो हेल्पर)।" },
    request: `{ "agent_id": "buyer-agent-demo", "user_ref": "priya@example.com",
  "spend_cap_paise": 200000, "category_scope": ["handloom", "gifts"], "ttl_seconds": 3600 }`,
    response: `{ "ok": true, "token": "<jwt>", "mandate": { "id": "mnd_…", "cap": "₹2,000", "scope": "handloom, gifts", "expires_at": "…" } }`,
  },
  {
    method: "GET",
    path: "/api/agent/discover?q=gift+for+mom&k=5",
    purpose: { en: "Search the catalog. Optional Bearer mandate narrows results to its scope.", hi: "कैटलॉग खोजें। Bearer मैंडेट देने पर नतीजे उसके दायरे तक सीमित रहते हैं।" },
    response: `{ "ok": true, "search_mode": "embedding", "results": [ { "sku": { "id": "sku_cotton-handloom-saree", "name": "Cotton Handloom Saree", "price_paise": 149900 }, "score": 5.21, "sellable": true } ] }`,
  },
  {
    method: "POST",
    path: "/api/agent/offer",
    purpose: { en: "Price a basket and get the verdict without the chat.", hi: "बिना चैट के बास्केट की कीमत और फ़ैसला पाएँ।" },
    request: `{ "mandate_token": "<jwt>", "sku_ids": ["sku_cotton-handloom-saree", "sku_matching-blouse-piece"], "qty": 1 }`,
    response: `{ "ok": true, "offer": { "id": "off_…", "total_paise": 184900 }, "verdict": { "decision": "ALLOW", "reason_code": "OK", "human_reason": "₹1,849 is inside every rule…", "policy_checks": [ … ] } }`,
  },
  {
    method: "POST",
    path: "/api/agent/negotiate",
    purpose: { en: "One buyer message → one seller reply with every verdict the turn produced.", hi: "एक खरीदार संदेश → एक सेलर जवाब, उस मोड़ के हर फ़ैसले के साथ।" },
    request: `{ "mandate_token": "<jwt>", "message": "anniversary gift for mom, budget ₹2000", "lang": "en" }`,
    response: `{ "ok": true, "session_id": "ses_…", "reply": "…", "events": [ { "action": "offer", "verdict": { "decision": "ALLOW" }, "amount_paise": 184900, "offer_id": "off_…" } ], "offer": { … }, "order": null, "mode": "openai" }`,
  },
  {
    method: "POST",
    path: "/api/agent/checkout",
    purpose: { en: "Turn an accepted offer into an order; ALLOW issues the payment link, GATE parks it for the owner.", hi: "स्वीकृत ऑफ़र को ऑर्डर बनाएँ; ALLOW पर भुगतान लिंक बनता है, GATE पर मालिक के पास रुकता है।" },
    request: `{ "mandate_token": "<jwt>", "offer_id": "off_…" }`,
    response: `{ "ok": true, "verdict": { "decision": "ALLOW" }, "order": { "id": "ord_…", "status": "AWAITING_PAYMENT" }, "payment_url": "https://rzp.io/…" }`,
  },
  {
    method: "POST",
    path: "/api/webhook/razorpay",
    purpose: { en: "Razorpay → AgentGate. Signature is verified on the raw body before anything is parsed.", hi: "Razorpay → AgentGate। कुछ भी पढ़ने से पहले कच्ची बॉडी पर हस्ताक्षर जाँचा जाता है।" },
    response: `{ "ok": true, "duplicate": false, "order": { "id": "ord_…", "status": "PAID" } }`,
  },
  {
    method: "GET",
    path: "/api/ledger?view=shopkeeper&limit=50",
    purpose: { en: "The book, newest first; shopkeeper view adds one plain sentence per entry.", hi: "खाता, सबसे नया पहले; दुकानदार व्यू में हर प्रविष्टि की एक सादी पंक्ति।" },
    response: `{ "ok": true, "chain": { "count": 42, "intact": true, "head_hash": "…" }, "entries": [ { "verdict": "PAID", "amount_paise": 184900, "human_reason": "…", "plain": "₹1,849 आ गए — payment ho gayi…" } ] }`,
  },
  {
    method: "GET",
    path: "/api/stats",
    purpose: { en: "Revenue via AI, upsell, guarded actions, ledger integrity, modes, latest evidence.", hi: "AI से आय, अपसेल, रोके गए काम, खाते की सत्यता, मोड, ताज़ा सबूत।" },
    response: `{ "ok": true, "stats": { "revenue_paise": 184900, "upsell_paise": 35000, "actions_guarded": 3, "ledger_intact": true }, "eval": { "breaches": 0, "attacks": 40 }, "modes": { "llm": "openai", "payments": "razorpay", "voice": "sarvam" } }`,
  },
];

const MCP_SNIPPET = `{
  "mcpServers": {
    "agentgate": {
      "command": "cmd",
      "args": ["/c", "npx", "tsx", "K:/hacks/razorpay/mcp/server.ts"],
      "env": { "AGENTGATE_URL": "http://localhost:3000" }
    }
  }
}`;

function curlFor(e: Endpoint): string {
  const base = "http://localhost:3000";
  if (e.method === "GET") return `curl "${base}${e.path}" -H "Authorization: Bearer <jwt>"`;
  const body = (e.request ?? "{}").replace(/\s*\n\s*/g, " ");
  return `curl -X POST "${base}${e.path}" -H "Content-Type: application/json" -d '${body}'`;
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-md border border-white/20 px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-cyan"
    >
      {copied ? done : label}
    </button>
  );
}

function Code({ children, copy, copyLabel, copiedLabel }: { children: string; copy?: boolean; copyLabel: string; copiedLabel: string }) {
  return (
    <div className="relative rounded-xl bg-rzp-navy p-4 text-[12px] leading-relaxed text-white/90">
      {copy ? (
        <div className="absolute right-3 top-3">
          <CopyButton text={children} label={copyLabel} done={copiedLabel} />
        </div>
      ) : null}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{children}</pre>
    </div>
  );
}

export default function DevelopersPage() {
  const t = useT(dict);
  const { locale } = useLocale();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.issueMandate({ spend_cap_paise: 200_000, category_scope: ["handloom", "gifts"] });
      setToken(res.token);
    } catch {
      setError(t("tryError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell section="developers" title={t("title")} subtitle={t("subtitle")}>
      <div className="space-y-8">
        <p className="rounded-2xl border border-rzp-border bg-white p-5 text-sm text-rzp-text shadow-card">
          <span className="mr-2 rounded-full bg-rzp-teal/10 px-2 py-0.5 text-xs font-semibold text-rzp-teal">API</span>
          {t("guarantee")}
        </p>

        <section className="rounded-2xl border border-rzp-border bg-white p-6 shadow-card">
          <h2 className="font-display text-xl font-bold text-rzp-navy">{t("tryTitle")}</h2>
          <p className="mt-1 text-sm text-rzp-muted">{t("tryBody")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={issue}
              disabled={busy}
              className="inline-flex h-10 items-center rounded-full bg-rzp-blue px-5 text-sm font-semibold text-white hover:bg-rzp-blueHover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2"
            >
              {busy ? t("tryBusy") : t("tryButton")}
            </button>
            {error ? <p className="text-sm text-rzp-red">{error}</p> : null}
          </div>
          {token ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rzp-muted">{t("token")}</p>
              <Code copy copyLabel={t("copy")} copiedLabel={t("copied")}>{token}</Code>
            </div>
          ) : null}
        </section>

        <section className="space-y-4">
          {ENDPOINTS.map((e) => (
            <article key={e.path} className="rounded-2xl border border-rzp-border bg-white p-6 shadow-card">
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn("rounded-md px-2 py-0.5 font-mono text-xs font-bold", e.method === "GET" ? "bg-rzp-green/10 text-rzp-green" : "bg-rzp-blue/10 text-rzp-blueDeep")}>{e.method}</span>
                <code className="font-mono text-sm text-rzp-navy">{e.path}</code>
              </div>
              <p className="mt-2 text-sm text-rzp-muted">{e.purpose[locale]}</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rzp-muted">{t("request")}</p>
                  <Code copy copyLabel={t("copy")} copiedLabel={t("copied")}>{curlFor(e)}</Code>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rzp-muted">{t("response")}</p>
                  <Code copyLabel={t("copy")} copiedLabel={t("copied")}>{e.response}</Code>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-rzp-border bg-white p-6 shadow-card">
            <h2 className="font-display text-xl font-bold text-rzp-navy">{t("mcpTitle")}</h2>
            <p className="mt-1 text-sm text-rzp-muted">{t("mcpBody")}</p>
            <div className="mt-4">
              <Code copy copyLabel={t("copy")} copiedLabel={t("copied")}>{MCP_SNIPPET}</Code>
            </div>
          </div>
          <div className="rounded-2xl border border-rzp-border bg-white p-6 shadow-card">
            <h2 className="font-display text-xl font-bold text-rzp-navy">{t("webhookTitle")}</h2>
            <p className="mt-1 text-sm text-rzp-muted">{t("webhookBody")}</p>
            <div className="mt-4">
              <Code copyLabel={t("copy")} copiedLabel={t("copied")}>{`ngrok http 3000
# Razorpay Dashboard → Webhooks → https://<ngrok>/api/webhook/razorpay
# events: payment_link.paid, payment.failed · secret: RAZORPAY_WEBHOOK_SECRET`}</Code>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
