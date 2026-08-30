"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { HeroCluster } from "@/components/landing/HeroCluster";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { MarketingFooter } from "@/components/landing/MarketingFooter";
import { MarketingHeader } from "@/components/landing/MarketingHeader";
import { ProductCards } from "@/components/landing/ProductCards";
import { RailsStrip } from "@/components/landing/RailsStrip";
import { StatsBand } from "@/components/landing/StatsBand";
import { MiniLedger } from "@/components/MiniLedger";
import { buttonClasses } from "@/components/ui/button";
import { api, type StatsResponse } from "@/lib/demo/client";
import { clearTourStep, isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";

type StatsState = { kind: "loading" } | { kind: "ready"; data: StatsResponse } | { kind: "error"; message: string };

type DelayStyle = CSSProperties & { "--delay"?: string };

/** fade-up stagger for the hero children */
function delay(ms: number): DelayStyle {
  return { "--delay": `${ms}ms` };
}

export default function LandingPage() {
  const [restartKey, setRestartKey] = useState(0);
  const [stats, setStats] = useState<StatsState>({ kind: "loading" });

  const onTour = useCallback((detail: TourEventDetail) => {
    if (detail.action === "landing:hero" && isTourActive()) setRestartKey((k) => k + 1);
  }, []);
  useTourAction(onTour);

  useEffect(() => {
    let cancelled = false;
    api
      .stats()
      .then((data) => {
        if (!cancelled) setStats({ kind: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setStats({ kind: "error", message: "Could not reach the shop for live figures. Check that the app is running." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = stats.kind === "ready" ? stats.data : null;
  const merchant = data?.merchant ?? null;

  return (
    <div className="min-h-screen bg-white text-rzp-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-rzp-navy focus:shadow-card"
      >
        Skip to content
      </a>

      <MarketingHeader />

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        {/*  Hero                                                            */}
        {/* ---------------------------------------------------------------- */}
        <section className="bg-hero relative -mt-16 overflow-hidden pb-24 pt-28 sm:pt-32 lg:pb-28 lg:pt-36" aria-labelledby="hero-heading">
          <div aria-hidden="true" className="bg-dots-light absolute inset-0" />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-white/50 via-white/15 to-transparent" />

          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10">
            <div className="min-w-0">
              <p
                className="fade-up inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-semibold text-rzp-navy shadow-sm backdrop-blur"
                style={delay(0)}
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-rzp-blue" />
                Razorpay Hackathon · Track 01 · Agentic commerce
              </p>

              <h1
                id="hero-heading"
                className="fade-up mt-6 font-display text-6xl font-bold leading-[0.95] tracking-tight text-rzp-navy sm:text-7xl"
                style={delay(80)}
              >
                Har paisa, likha hua.
              </h1>
              <p className="fade-up mt-5 max-w-xl text-lg leading-relaxed text-rzp-navy/85 sm:text-xl" style={delay(160)}>
                Every rupee your AI sells — explained, bounded, and written down.
              </p>

              <div className="fade-up mt-8 flex flex-wrap items-center gap-3" style={delay(240)}>
                <Link
                  href="/onboard"
                  className={buttonClasses({
                    variant: "primary",
                    size: "lg",
                    className: "border-rzp-navy bg-rzp-navy shadow-card hover:border-rzp-blueDeep hover:bg-rzp-blueDeep",
                  })}
                >
                  Onboard a shop
                </Link>
                <Link
                  href="/?tour=1"
                  onClick={clearTourStep}
                  className={buttonClasses({
                    variant: "secondary",
                    size: "lg",
                    className: "border-white/70 bg-white/80 text-rzp-navy backdrop-blur hover:border-white hover:bg-white",
                  })}
                >
                  Watch the Grand Tour
                </Link>
              </div>

              <div className="fade-up mt-10 max-w-xl" style={delay(320)}>
                <MiniLedger frame="glass" restartKey={restartKey} />
              </div>

              <p className="mt-4 min-h-[1.25rem] text-sm text-rzp-navy/80" aria-live="polite">
                {data ? (
                  merchant?.live ? (
                    <>
                      {merchant.name} ki dukaan is live for AI buyers · payments on{" "}
                      <span className="font-mono">{data.modes.payments === "razorpay" ? "Razorpay test rails" : "the mock adapter"}</span>
                    </>
                  ) : (
                    "No shop is live yet — onboard one to open the book."
                  )
                ) : stats.kind === "error" ? (
                  stats.message
                ) : null}
              </p>
            </div>

            <HeroCluster className={cn("fade-up lg:justify-self-end")} />
          </div>
        </section>

        <StatsBand stats={data} loading={stats.kind === "loading"} />

        <ProductCards />

        <HowItWorks />

        <RailsStrip payments={data?.modes.payments ?? null} />
      </main>

      <MarketingFooter />
    </div>
  );
}
