import { json } from "@/lib/api";
import { getMerchant } from "@/lib/db";
import { chatText, llmMode } from "@/lib/llm/router";
import { formatINR } from "@/lib/money";
import { LangSchema, type Lang } from "@/lib/schemas";
import { getStats, type Stats } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/**
 * The spoken day summary. Hindi is written in Devanagari because Indian TTS
 * voices read it properly and mangle Latin-script Hinglish; English is the
 * fallback for browsers without a Hindi voice.
 *
 * `?lang=hi|en` picks the primary text (`text`, echoed with `lang`); both `hi`
 * and `en` are always in the response. The model only polishes the Hindi when
 * Hindi is the primary — an English caller gets the template Hindi for free.
 */

function langFrom(req: Request): Lang {
  let raw: string | null = null;
  try {
    raw = new URL(req.url).searchParams.get("lang");
  } catch {
    raw = null;
  }
  const parsed = LangSchema.safeParse(raw);
  return parsed.success ? parsed.data : "en";
}

function hindiTemplate(s: Stats, pending: number): string {
  if (!s.ledger_intact) return "सावधान — खाते में छेड़छाड़ का निशान मिला है। कृपया Control Tower में लेजर की जाँच करें।";
  const parts: string[] = ["नमस्ते जी!"];
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
      ? `Namaste ji. Today the AI sold ${formatINR(s.revenue_paise)}, including ${formatINR(s.upsell_paise)} of upsell.`
      : "Namaste ji. No sales yet today.";
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
      "You are the shop's trusted munim telling the owner the day's news aloud — two sentences of natural spoken Hindi, Devanagari script only, warm and unhurried, like news shared over chai. Open with a short greeting (नमस्ते जी). Keep the ₹ amounts exactly as given. No English words except product names, no URLs or ids, no markdown, at most 40 words.",
    messages: [{ role: "user", content: JSON.stringify(facts) }],
    temperature: 0,
    max_tokens: 120,
    timeoutMs: 8000,
  });
}

export async function GET(req: Request) {
  const lang = langFrom(req);
  const stats = getStats();
  const pending = stats.pending_approvals;
  const merchant = getMerchant()?.name ?? "the shop";
  const en = englishTemplate(stats, pending);
  const hi = (lang === "hi" ? await hindiFromModel(stats, pending, merchant) : null) ?? hindiTemplate(stats, pending);
  return json({ ok: true, lang, text: lang === "hi" ? hi : en, hi, en, source: llmMode() });
}
