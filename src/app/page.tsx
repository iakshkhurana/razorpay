"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChatVerdict, LedgerStamp, ShieldCheck, Storefront } from "@/components/illustrations";
import { MarketingFooter } from "@/components/landing/MarketingFooter";
import { MarketingHeader } from "@/components/landing/MarketingHeader";
import { StatsBand } from "@/components/landing/StatsBand";
import { MiniLedger } from "@/components/MiniLedger";
import { BrowserFrame, IndustryTabs, Marquee, Reveal, StickyFeatures } from "@/components/motion";
import { VerdictStamp } from "@/components/VerdictStamp";
import { api, type StatsResponse } from "@/lib/demo/client";
import { useT } from "@/lib/i18n/core";
import { landing } from "@/lib/i18n/strings/landing";
import { formatINR } from "@/lib/money";
import { clearTourStep, isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";

const HERO_GRADIENT = "linear-gradient(180deg, #2F6BFF 0%, #5B93FF 22%, #A9CCFF 45%, #F3F7FF 68%, #FFFFFF 100%)";

type TFn = (k: string, v?: Record<string, string>) => string;

const pillPrimary =
  "inline-flex h-12 items-center justify-center rounded-full bg-rzp-navy px-7 text-sm font-semibold text-white shadow-lg shadow-rzp-navy/20 transition hover:bg-rzp-blueDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2";
const pillSecondary =
  "inline-flex h-12 items-center justify-center rounded-full border border-white/70 bg-white/85 px-7 text-sm font-semibold text-rzp-navy backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2";

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs font-semibold uppercase tracking-[0.18em] text-rzp-teal", className)}>{children}</p>;
}

function Ornament() {
  return (
    <svg viewBox="0 0 220 24" className="mx-auto h-6 w-56 text-white/90" aria-hidden="true">
      <path d="M0 12h78M142 12h78" stroke="currentColor" strokeWidth="1.2" />
      <path d="M86 12c8-10 20-10 24 0-4 10-16 10-24 0Zm48 0c-8-10-20-10-24 0 4 10 16 10 24 0Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="110" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

/* ---- small UI mocks used inside the feature panels and the preview ---- */

function RulebookMock({ t }: { t: TFn }) {
  const rows: Array<[string, string]> = [
    [t("mock.rule.floor"), "85%"],
    [t("mock.rule.discount"), "10%"],
    [t("mock.rule.qty"), "4"],
    [t("mock.rule.gate"), formatINR(500_000)],
  ];
  return (
    <div className="w-full max-w-sm rounded-2xl border border-rzp-border bg-white p-5 shadow-card" role="img" aria-label={t("mock.rulebook.aria")}>
      <div className="flex items-center justify-between">
        <p className="font-display font-bold text-rzp-navy">{t("mock.rulebook.title")}</p>
        <span className="rounded-full bg-rzp-green/10 px-2 py-0.5 text-xs font-semibold text-rzp-green">{t("mock.rulebook.approved")}</span>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <li key={label} className="flex items-center justify-between text-sm">
            <span className="text-rzp-muted">{label}</span>
            <span className="font-mono font-semibold text-rzp-text">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatMock({ t }: { t: (k: string) => string }) {
  return (
    <div className="w-full max-w-sm space-y-3" role="img" aria-label={t("mock.chat.aria")}>
      <div className="ml-10 rounded-2xl rounded-tr-md bg-rzp-blue px-4 py-3 text-sm text-white">{t("mock.chat.buyer")}</div>
      <div className="mr-10 rounded-2xl rounded-tl-md border border-rzp-border bg-white px-4 py-3 text-sm text-rzp-text shadow-card">
        {t("mock.chat.seller")}
        <div className="mt-3 flex items-center gap-3 border-t border-rzp-border pt-3">
          <VerdictStamp kind="ALLOW" size="sm" animate={false} />
          <span className="font-mono text-sm font-semibold text-rzp-navy">{formatINR(184_900)}</span>
        </div>
      </div>
      <div className="ml-10 rounded-2xl rounded-tr-md bg-rzp-blue px-4 py-3 text-sm text-white">{t("mock.chat.buyer2")}</div>
    </div>
  );
}

function OwnerMock({ t }: { t: (k: string, v?: Record<string, string>) => string }) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-rzp-violet/30 bg-white p-5 shadow-card" role="img" aria-label={t("mock.owner.aria")}>
      <div className="flex items-center justify-between">
        <Eyebrow className="text-rzp-violet">{t("mock.owner.eyebrow")}</Eyebrow>
        <VerdictStamp kind="GATE" size="sm" animate={false} />
      </div>
      <p className="mt-3 font-mono text-3xl font-bold text-rzp-navy">{formatINR(564_800)}</p>
      <p className="mt-1 text-sm font-medium text-rzp-text">{t("mock.owner.title")}</p>
      <p className="mt-1 text-sm text-rzp-muted">{t("mock.owner.reason")}</p>
      <div className="mt-4 flex gap-2">
        <span className="inline-flex h-9 flex-1 items-center justify-center rounded-full bg-rzp-blue text-xs font-semibold text-white">{t("mock.owner.approve")}</span>
        <span className="inline-flex h-9 flex-1 items-center justify-center rounded-full border border-rzp-red text-xs font-semibold text-rzp-red">{t("mock.owner.reject")}</span>
      </div>
    </div>
  );
}

function LedgerMock({ t }: { t: (k: string) => string }) {
  const rows: Array<{ label: string; reason: string; amount: number; stamp: "ALLOW" | "COUNTER" | "PAID" }> = [
    { label: t("mock.ledger.row1"), reason: t("mock.ledger.row1.reason"), amount: 184_900, stamp: "ALLOW" },
    { label: t("mock.ledger.row2"), reason: t("mock.ledger.row2.reason"), amount: 1_499_700, stamp: "COUNTER" },
    { label: t("mock.ledger.row3"), reason: t("mock.ledger.row3.reason"), amount: 184_900, stamp: "PAID" },
  ];
  return (
    <div className="ledger-spine ruled-paper w-full max-w-sm rounded-2xl border border-rzp-border bg-white pl-4 shadow-card" role="img" aria-label={t("mock.ledger.aria")}>
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="font-display text-sm font-bold text-rzp-navy">{t("mock.ledger.title")}</p>
        <span className="text-xs font-semibold text-rzp-green">✓ {t("mock.ledger.chain")}</span>
      </div>
      <ul className="divide-y divide-rzp-border/70">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-rzp-text">{r.label}</p>
              <p className="text-xs text-rzp-muted">{r.reason}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="font-mono text-sm tnum">{formatINR(r.amount)}</span>
              <VerdictStamp kind={r.stamp} size="sm" animate={false} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TowerMock({ t, stats }: { t: (k: string) => string; stats: StatsResponse | null }) {
  const s = stats?.stats;
  const tiles: Array<[string, string, string]> = [
    [t("mock.tower.revenue"), formatINR(s?.revenue_paise ?? 184_900), "text-rzp-green"],
    [t("mock.tower.upsell"), formatINR(s?.upsell_paise ?? 35_000), "text-rzp-navy"],
    [t("mock.tower.guarded"), String(s?.actions_guarded ?? 3), "text-rzp-navy"],
    [t("mock.tower.integrity"), s?.ledger_intact === false ? "✗" : "✓", "text-rzp-green"],
  ];
  return (
    <div className="bg-rzp-ice p-4 sm:p-6" role="img" aria-label={t("mock.tower.aria")}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-rzp-border bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-rzp-muted">{label}</p>
            <p className={cn("mt-1 font-mono text-lg font-bold tnum", tone)}>{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
        <LedgerMock t={t} />
        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-rzp-muted">{t("mock.tower.approvals")}</p>
          <OwnerMock t={t} />
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const t = useT(landing) as unknown as TFn;
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .stats()
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch(() => {
        if (alive) setOffline(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onTour = useCallback((detail: TourEventDetail) => {
    if (!isTourActive()) return;
    if (detail.action === "landing:hero") setRestartKey((k) => k + 1);
  }, []);
  useTourAction(onTour);

  const merchant = stats?.merchant;
  const rail = stats?.modes.payments === "razorpay" ? t("hero.railRazorpay") : t("hero.railMock");

  const features = [
    { id: "onboard", eyebrow: t("f1.eyebrow"), title: t("f1.title"), body: t("f1.body"), accent: "blue" as const, visual: <div className="flex items-center gap-6"><Storefront className="hidden w-40 md:block" /><RulebookMock t={t} /></div> },
    { id: "negotiate", eyebrow: t("f2.eyebrow"), title: t("f2.title"), body: t("f2.body"), accent: "teal" as const, visual: <div className="flex items-center gap-6"><ChatVerdict className="hidden w-40 md:block" /><ChatMock t={t} /></div> },
    { id: "approve", eyebrow: t("f3.eyebrow"), title: t("f3.title"), body: t("f3.body"), accent: "saffron" as const, visual: <div className="flex items-center gap-6"><ShieldCheck className="hidden w-40 md:block" /><OwnerMock t={t} /></div> },
    { id: "record", eyebrow: t("f4.eyebrow"), title: t("f4.title"), body: t("f4.body"), accent: "blue" as const, visual: <div className="flex items-center gap-6"><LedgerStamp className="hidden w-40 md:block" /><LedgerMock t={t} /></div> },
  ];

  const industries = [
    { id: "retail", label: t("ind.retail.label"), title: t("ind.retail.title"), highlight: t("ind.retail.highlight"), body: t("ind.retail.body"), image: "/images/industry-retail.jpg", imageAlt: t("ind.retail.alt"), bullets: [t("ind.retail.b1"), t("ind.retail.b2"), t("ind.retail.b3"), t("ind.retail.b4")], cta: { label: t("ind.retail.cta"), href: "/onboard" } },
    { id: "fuel", label: t("ind.fuel.label"), title: t("ind.fuel.title"), highlight: t("ind.fuel.highlight"), body: t("ind.fuel.body"), image: "/images/industry-fuel.jpg", imageAlt: t("ind.fuel.alt"), bullets: [t("ind.fuel.b1"), t("ind.fuel.b2"), t("ind.fuel.b3"), t("ind.fuel.b4")], cta: { label: t("ind.fuel.cta"), href: "/simulator" } },
  ];

  const plans = [
    { name: t("pricing.starter"), forWhom: t("pricing.starter.for"), items: [t("pricing.starter.f1"), t("pricing.starter.f2"), t("pricing.starter.f3"), t("pricing.starter.f4")], popular: false },
    { name: t("pricing.growth"), forWhom: t("pricing.growth.for"), items: [t("pricing.growth.f1"), t("pricing.growth.f2"), t("pricing.growth.f3"), t("pricing.growth.f4"), t("pricing.growth.f5")], popular: true },
    { name: t("pricing.enterprise"), forWhom: t("pricing.enterprise.for"), items: [t("pricing.enterprise.f1"), t("pricing.enterprise.f2"), t("pricing.enterprise.f3"), t("pricing.enterprise.f4"), t("pricing.enterprise.f5")], popular: false },
  ];

  return (
    <div className="min-h-screen bg-white text-rzp-text">
      <div style={{ backgroundImage: HERO_GRADIENT }} className="relative">
        <MarketingHeader />
        <section className="relative overflow-hidden px-6 pb-20 pt-14 sm:pt-20">
          <div className="pointer-events-none absolute inset-0 bg-dots opacity-40" aria-hidden="true" />
          <div className="relative mx-auto max-w-4xl text-center">
            <Reveal>
              <Ornament />
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/70 px-4 py-1.5 text-xs font-semibold text-rzp-navy backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-rzp-saffron" aria-hidden="true" />
                {t("hero.eyebrow")}
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-rzp-navy sm:text-7xl">{t("hero.title")}</h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-rzp-navy/80 sm:text-xl">{t("hero.sub")}</p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/onboard" className={pillPrimary}>
                  {t("hero.ctaOnboard")}
                </Link>
                <Link href="/?tour=1" onClick={clearTourStep} className={pillSecondary}>
                  {t("hero.ctaTour")}
                </Link>
              </div>
            </Reveal>
            <Reveal delay={0.32}>
              <div className="mx-auto mt-12 max-w-2xl">
                <MiniLedger frame="glass" restartKey={restartKey} />
              </div>
              <p className="mt-4 text-sm text-rzp-navy/70">
                {offline ? t("hero.offline") : merchant?.live ? t("hero.liveNote", { name: merchant.name, rail }) : loading ? "" : t("hero.noShop")}
              </p>
            </Reveal>
          </div>
        </section>
      </div>

      <Marquee
        label={t("marquee.label")}
        items={[t("marquee.engine"), t("marquee.ledger"), t("marquee.rails"), t("marquee.voice"), t("marquee.mcp"), t("marquee.mandates"), t("marquee.owner")].map((s) => (
          <span key={s} className="rounded-full border border-rzp-border bg-white px-4 py-1.5 text-sm font-medium text-rzp-navy">
            {s}
          </span>
        ))}
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <StatsBand stats={stats} loading={loading} />
      </section>

      <section className="mx-auto max-w-6xl px-6" id="product">
        <Reveal>
          <Eyebrow>{t("features.eyebrow")}</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-bold text-rzp-navy sm:text-4xl">{t("features.title")}</h2>
          <p className="mt-3 max-w-2xl text-rzp-muted">{t("features.sub")}</p>
        </Reveal>
      </section>
      <StickyFeatures items={features} railLabel={t("features.rail")} className="mx-auto max-w-6xl px-6" />

      <section className="mx-auto max-w-6xl px-6 py-20" id="industries">
        <Reveal>
          <Eyebrow>{t("industries.eyebrow")}</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-bold text-rzp-navy sm:text-4xl">{t("industries.title")}</h2>
          <p className="mt-3 max-w-2xl text-rzp-muted">{t("industries.sub")}</p>
        </Reveal>
        <div className="mt-8">
          <IndustryTabs tabs={industries} label={t("industries.label")} />
        </div>
      </section>

      <section className="bg-rzp-ice py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-[1fr_1.4fr]">
          <Reveal>
            <Eyebrow>{t("preview.eyebrow")}</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-bold text-rzp-navy sm:text-4xl">{t("preview.title")}</h2>
            <p className="mt-3 text-rzp-muted">{t("preview.body")}</p>
            <ul className="mt-5 space-y-2 text-sm text-rzp-text">
              {[t("preview.p1"), t("preview.p2"), t("preview.p3")].map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="text-rzp-green" aria-hidden="true">✓</span>
                  {p}
                </li>
              ))}
            </ul>
            <Link href="/dashboard" className={cn(pillPrimary, "mt-6")}>
              {t("preview.cta")}
            </Link>
          </Reveal>
          <Reveal delay={0.1}>
            <BrowserFrame url="agentgate.app/dashboard" label={t("preview.frameLabel")}>
              <TowerMock t={t} stats={stats} />
            </BrowserFrame>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20" id="pricing">
        <Reveal>
          <Eyebrow>{t("pricing.eyebrow")}</Eyebrow>
          <h2 className="mt-2 font-display text-3xl font-bold text-rzp-navy sm:text-4xl">{t("pricing.title")}</h2>
          <p className="mt-3 max-w-2xl text-rzp-muted">{t("pricing.sub")}</p>
        </Reveal>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.06}>
              <div className={cn("relative flex h-full flex-col rounded-2xl border bg-white p-6 shadow-card", plan.popular ? "border-rzp-blue ring-2 ring-rzp-blue/20" : "border-rzp-border")}>
                {plan.popular ? <span className="absolute -top-3 left-6 rounded-full bg-rzp-saffron px-3 py-1 text-xs font-semibold text-white">{t("pricing.popular")}</span> : null}
                <h3 className="font-display text-xl font-bold text-rzp-navy">{plan.name}</h3>
                <p className="mt-1 text-sm text-rzp-muted">{plan.forWhom}</p>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-rzp-navy">{t("pricing.price")}</span>
                  <span className="text-xs text-rzp-muted">{t("pricing.per")}</span>
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-rzp-text">
                  {plan.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-rzp-green" aria-hidden="true">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/pricing" className="mt-6 text-sm font-semibold text-rzp-blueDeep hover:underline">
                  {t("pricing.cta")} →
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20" id="developers">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>{t("dev.eyebrow")}</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-bold text-rzp-navy sm:text-4xl">{t("dev.title")}</h2>
            <p className="mt-3 text-rzp-muted">{t("dev.body")}</p>
            <ul className="mt-5 space-y-2 font-mono text-xs text-rzp-text sm:text-sm">
              {[t("dev.p1"), t("dev.p2"), t("dev.p3")].map((p) => (
                <li key={p} className="rounded-lg bg-rzp-ice px-3 py-2">{p}</li>
              ))}
            </ul>
            <Link href="/developers" className={cn(pillPrimary, "mt-6")}>
              {t("dev.cta")}
            </Link>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-2xl bg-rzp-navy p-5 text-[12px] leading-relaxed text-white/90 shadow-card" role="img" aria-label={t("dev.frameLabel")}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-rzp-cyan">{t("dev.request")}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono">{`curl -X POST http://localhost:3000/api/mandate/issue \\
  -H "Content-Type: application/json" \\
  -d '{"spend_cap_paise":200000,"category_scope":["handloom","gifts"]}'`}</pre>
              <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-rzp-cyan">{t("dev.response")}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono">{`{ "ok": true, "token": "eyJhbGciOiJIUzI1NiJ9…",
  "mandate": { "cap": "₹2,000", "scope": "handloom, gifts", "expires_in_seconds": 3600 } }`}</pre>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-rzp-navy px-6 py-16 text-center text-white" style={{ backgroundImage: "linear-gradient(180deg, #0B1D3A 0%, #1B45B8 100%)" }}>
            <div className="pointer-events-none absolute inset-0 bg-dots opacity-20" aria-hidden="true" />
            <div className="relative">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">{t("cta.title")}</h2>
              <p className="mx-auto mt-3 max-w-xl text-white/80">{t("cta.body")}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/onboard" className="inline-flex h-12 items-center rounded-full bg-white px-7 text-sm font-semibold text-rzp-navy hover:bg-rzp-ice focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-cyan">
                  {t("cta.primary")}
                </Link>
                <Link href="/dashboard" className="inline-flex h-12 items-center rounded-full border border-white/50 px-7 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-cyan">
                  {t("cta.secondary")}
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <MarketingFooter />
    </div>
  );
}
