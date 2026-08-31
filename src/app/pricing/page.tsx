"use client";

import Link from "next/link";
import { MarketingHeader } from "@/components/landing/MarketingHeader";
import { useLocale, useT } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

const dict = {
  en: {
    eyebrow: "Pricing",
    title: "Simple plans. Free while we're in the hackathon.",
    sub: "Every plan runs the same policy engine, the same hash-chained ledger and the same Razorpay test rails. Pick the shape that fits your shop.",
    free: "Free",
    freeNote: "during the hackathon",
    cta: "Start free",
    popular: "Most shops",
    starter: "Starter",
    starterTag: "One shop, one seller agent",
    growth: "Growth",
    growthTag: "Several shops, many buyer agents",
    enterprise: "Enterprise",
    enterpriseTag: "Your rails, your rules, your audit",
    faqTitle: "Questions",
    footer: "Free during beta · Razorpay test rails",
  },
  hi: {
    eyebrow: "प्लान",
    title: "सीधे-सादे प्लान। हैकाथॉन के दौरान पूरी तरह मुफ़्त।",
    sub: "हर प्लान में वही पॉलिसी इंजन, वही हैश-चेन वाला खाता और वही Razorpay टेस्ट रेल्स चलती हैं। अपनी दुकान के हिसाब से चुनिए।",
    free: "मुफ़्त",
    freeNote: "हैकाथॉन के दौरान",
    cta: "मुफ़्त शुरू करें",
    popular: "ज़्यादातर दुकानें",
    starter: "स्टार्टर",
    starterTag: "एक दुकान, एक सेलर एजेंट",
    growth: "ग्रोथ",
    growthTag: "कई दुकानें, कई खरीदार एजेंट",
    enterprise: "एंटरप्राइज़",
    enterpriseTag: "आपकी रेल्स, आपके नियम, आपका ऑडिट",
    faqTitle: "सवाल",
    footer: "बीटा में मुफ़्त · Razorpay टेस्ट रेल्स",
  },
};

const FEATURES = {
  en: {
    starter: ["1 shop, unlimited catalog", "Seller agent with one upsell per chat", "Policy engine with 10 rules", "Hash-chained ledger, 30-day view", "Razorpay test-mode payments", "Browser voice (Hindi & English)"],
    growth: ["Up to 10 shops", "Unlimited buyer mandates", "Owner approval queue & HELD recovery", "Ledger export & integrity proofs", "Sarvam voice for the agents", "MCP tools for external agents"],
    enterprise: ["Unlimited shops & agents", "Custom rule packs per category", "Webhook-verified live rails", "Red-team evidence runs on demand", "Dedicated policy review", "Priority support"],
  },
  hi: {
    starter: ["1 दुकान, असीमित कैटलॉग", "एक चैट में एक अपसेल वाला सेलर एजेंट", "10 नियमों वाला पॉलिसी इंजन", "हैश-चेन खाता, 30 दिन का व्यू", "Razorpay टेस्ट-मोड भुगतान", "ब्राउज़र आवाज़ (हिंदी और अंग्रेज़ी)"],
    growth: ["10 दुकानों तक", "असीमित खरीदार मैंडेट", "मालिक की मंज़ूरी कतार और HELD रिकवरी", "खाता निर्यात और सत्यापन प्रमाण", "एजेंटों के लिए Sarvam आवाज़", "बाहरी एजेंटों के लिए MCP टूल"],
    enterprise: ["असीमित दुकानें और एजेंट", "श्रेणी के हिसाब से नियम-पैक", "वेबहुक-सत्यापित लाइव रेल्स", "मांग पर रेड-टीम सबूत", "समर्पित पॉलिसी समीक्षा", "प्राथमिकता सहायता"],
  },
};

const FAQ = {
  en: [
    ["Is it really free?", "Yes. During the hackathon every plan is free and runs on Razorpay test mode; no card is needed."],
    ["Can the AI move money on its own?", "No. Every money action passes the deterministic policy engine first; the model only talks."],
    ["What happens on a failed payment?", "The order goes to HELD, a backup link is issued automatically and every hop is written to the ledger."],
    ["Does it work in Hindi?", "The site, the agents and the voice follow the language toggle — Hindi in Devanagari, not Hinglish."],
  ],
  hi: [
    ["क्या यह सच में मुफ़्त है?", "हाँ। हैकाथॉन के दौरान हर प्लान मुफ़्त है और Razorpay टेस्ट मोड पर चलता है; कार्ड की ज़रूरत नहीं।"],
    ["क्या AI अपने आप पैसा भेज सकता है?", "नहीं। हर पैसे वाला काम पहले पॉलिसी इंजन से गुज़रता है; मॉडल सिर्फ़ बात करता है।"],
    ["भुगतान फेल हो जाए तो?", "ऑर्डर HELD में जाता है, बैकअप लिंक अपने आप बनता है और हर कदम खाते में लिखा जाता है।"],
    ["क्या यह हिंदी में चलता है?", "साइट, एजेंट और आवाज़ भाषा टॉगल के साथ चलते हैं — देवनागरी हिंदी में, हिंग्लिश में नहीं।"],
  ],
};

export default function PricingPage() {
  const t = useT(dict);
  const { locale } = useLocale();
  const features = FEATURES[locale];
  const faq = FAQ[locale];
  const plans = [
    { key: "starter", name: t("starter"), tag: t("starterTag"), items: features.starter, popular: false },
    { key: "growth", name: t("growth"), tag: t("growthTag"), items: features.growth, popular: true },
    { key: "enterprise", name: t("enterprise"), tag: t("enterpriseTag"), items: features.enterprise, popular: false },
  ];

  return (
    <div className="min-h-screen bg-rzp-ice">
      <MarketingHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rzp-teal">{t("eyebrow")}</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-tight text-rzp-navy sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 max-w-2xl text-lg text-rzp-muted">{t("sub")}</p>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <section
              key={plan.key}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-white p-7 shadow-card",
                plan.popular ? "border-rzp-blue ring-2 ring-rzp-blue/20" : "border-rzp-border",
              )}
            >
              {plan.popular ? (
                <span className="absolute -top-3 left-6 rounded-full bg-rzp-saffron px-3 py-1 text-xs font-semibold text-white">{t("popular")}</span>
              ) : null}
              <h2 className="font-display text-2xl font-bold text-rzp-navy">{plan.name}</h2>
              <p className="mt-1 text-sm text-rzp-muted">{plan.tag}</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold text-rzp-navy">{t("free")}</span>
                <span className="text-sm text-rzp-muted">{t("freeNote")}</span>
              </p>
              <ul className="mt-6 space-y-3 text-sm text-rzp-text">
                {plan.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true" className="mt-0.5 text-rzp-green">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/onboard"
                className={cn(
                  "mt-8 inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
                  plan.popular ? "bg-rzp-blue text-white hover:bg-rzp-blueHover" : "border border-rzp-navy text-rzp-navy hover:bg-rzp-navy hover:text-white",
                )}
              >
                {t("cta")}
              </Link>
            </section>
          ))}
        </div>

        <section className="mt-20 max-w-3xl">
          <h2 className="font-display text-2xl font-bold text-rzp-navy">{t("faqTitle")}</h2>
          <dl className="mt-6 divide-y divide-rzp-border rounded-2xl border border-rzp-border bg-white">
            {faq.map(([q, a]) => (
              <div key={q} className="p-5">
                <dt className="font-semibold text-rzp-text">{q}</dt>
                <dd className="mt-1 text-sm text-rzp-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <footer className="border-t border-rzp-border bg-white py-8 text-center text-sm text-rzp-muted">{t("footer")}</footer>
    </div>
  );
}
