import { json } from "@/lib/api";
import { getMerchant } from "@/lib/db";
import { chatText, llmMode } from "@/lib/llm/router";
import { formatINR } from "@/lib/money";
import { getStats, type Stats } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/**
 * The spoken day summary. Hindi is written in Devanagari because Indian TTS
 * voices read it properly and mangle Latin-script Hinglish; English is the
 * fallback for browsers without a Hindi voice.
 */

function hindiTemplate(s: Stats, pending: number): string {
  if (!s.ledger_intact) return "सावधान — खाते में छेड़छाड़ का निशान मिला है। कृपया Control Tower में लेजर की जाँच करें।";
  const parts: string[] = [];
  if (s.revenue_paise > 0) {
    parts.push(`आज AI ने ${formatINR(s.revenue_paise)} की बिक्री की, जिसमें ${formatINR(s.upsell_paise)} का अपसेल शामिल है।`);
  } else {
    parts.push("आज अभी तक कोई बिक्री नहीं हुई है।");
  }
  if (pending > 0) parts.push(`${pending} ऑर्डर आपकी मंज़ूरी का इंतज़ार कर रहे हैं।`);
  else if (s.actions_guarded > 0) parts.push(`${s.actions_guarded} कोशिशें नियमों ने रोकीं, और खाता पूरी तरह सही है।`);
  else parts.push("खाता पूरी तरह सही है।");
  return parts.join(" ");
}

function englishTemplate(s: Stats, pending: number): string {
  if (!s.ledger_intact) return "Warning — the ledger shows signs of tampering. Please check the book in the Control Tower.";
  const first =
    s.revenue_paise > 0
      ? `Today the AI sold ${formatINR(s.revenue_paise)}, including ${formatINR(s.upsell_paise)} of upsell.`
      : "No sales yet today.";
  const second =
    pending > 0
      ? `${pending} order${pending === 1 ? " is" : "s are"} waiting for your approval.`
      : s.actions_guarded > 0
        ? `${s.actions_guarded} attempts were stopped by the rules, and the ledger is intact.`
        : "The ledger is intact.";
  return `${first} ${second}`;
}

async function hindiFromModel(s: Stats, pending: number, merchant: string): Promise<string | null> {
  if (llmMode() !== "openai") return null;
  const facts = {
    merchant,
    revenue: formatINR(s.revenue_paise),
    upsell: formatINR(s.upsell_paise),
    orders_paid: s.orders_paid,
    guarded: s.actions_guarded,
    pending_approvals: pending,
    ledger_intact: s.ledger_intact,
  };
  return chatText({
    model: "light",
    system:
      "You write a two-sentence spoken day summary for an Indian shopkeeper in natural Hindi, Devanagari script only, warm and plain. Keep the ₹ amounts exactly as given. No English words except product names, no markdown, no lists, at most 35 words.",
    messages: [{ role: "user", content: JSON.stringify(facts) }],
    temperature: 0,
    max_tokens: 120,
    timeoutMs: 8000,
  });
}

export async function GET() {
  const stats = getStats();
  const pending = stats.pending_approvals;
  const merchant = getMerchant()?.name ?? "the shop";
  const hi = (await hindiFromModel(stats, pending, merchant)) ?? hindiTemplate(stats, pending);
  return json({ ok: true, hi, en: englishTemplate(stats, pending), source: llmMode() });
}
