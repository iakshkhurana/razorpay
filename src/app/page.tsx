"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MiniLedger } from "@/components/MiniLedger";
import { SiteHeader } from "@/components/SiteHeader";
import { api, type StatsResponse } from "@/lib/demo/client";
import { clearTourStep, isTourActive, useTourAction, type TourEventDetail } from "@/lib/tour/client";
import { cn } from "@/lib/utils";

const LINK_BUTTON = "inline-flex h-12 items-center justify-center rounded-xl border px-6 text-base font-medium transition-colors";
const LINK_PRIMARY = "border-action bg-action text-paper hover:bg-action/90";
const LINK_GHOST = "border-transparent bg-transparent text-action hover:bg-action/5";

const PIPELINE: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Onboard",
    body: "Paste a catalog URL or CSV, or just say the rules aloud. AgentGate drafts the price floor, discount cap and order limits; the shopkeeper approves them. Humans set the rules.",
  },
  {
    title: "Agents negotiate inside the rules",
    body: "An AI buyer arrives with a signed mandate. The seller agent searches, bundles and counters — but every offer passes a deterministic policy engine first. The model never touches money.",
  },
  {
    title: "Every rupee written down",
    body: "Each verdict — allowed, countered, gated, denied, paid or failed — lands in a hash-chained ledger with its reason. The Control Tower reads it back in plain words or raw JSON.",
  },
];

type StatsState = { kind: "loading" } | { kind: "ready"; data: StatsResponse } | { kind: "error"; message: string };

function signedPct(n: number): string {
  const rounded = Math.round(n);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
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
  const evalFacts = data?.eval ?? null;
  const merchant = data?.merchant ?? null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6">
        <section className="pb-16 pt-14 sm:pt-20">
          <h1 className="font-display text-6xl font-bold leading-[0.95] tracking-tight sm:text-8xl">Har paisa, likha hua.</h1>
          <p className="mt-6 max-w-2xl text-lg text-ink/70 sm:text-xl">Every rupee your AI sells — explained, bounded, and written down.</p>

          <MiniLedger restartKey={restartKey} className="mt-10 max-w-2xl" />

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/onboard" className={cn(LINK_BUTTON, LINK_PRIMARY)}>
              Onboard a shop
            </Link>
            <Link href="/?tour=1" onClick={clearTourStep} className={cn(LINK_BUTTON, LINK_GHOST)}>
              Watch the Grand Tour
            </Link>
          </div>

          {evalFacts ? (
            <p className="mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-ink/70" aria-label="Evidence from the last eval run">
              <Fact value={String(evalFacts.breaches)} label={`${evalFacts.breaches === 1 ? "breach" : "breaches"} across ${evalFacts.attacks} attacks`} tone={evalFacts.breaches === 0 ? "money" : "deny"} />
              <Dot />
              <Fact value={`${Math.round(evalFacts.explained_pct)}%`} label="explained" />
              <Dot />
              <Fact value={signedPct(evalFacts.revenue_uplift_pct)} label="revenue" tone={evalFacts.revenue_uplift_pct >= 0 ? "money" : "deny"} />
            </p>
          ) : null}

          {data ? (
            <p className="mt-6 text-sm text-ink/70">
              {merchant?.live ? (
                <>
                  {merchant.name} is live for AI buyers · payments: <span className="font-mono">{data.modes.payments}</span>
                </>
              ) : (
                "No shop is live yet — onboard one to open the book."
              )}
            </p>
          ) : null}

          {stats.kind === "error" ? <p className="mt-6 text-sm text-ink/70">{stats.message}</p> : null}
        </section>

        <section aria-labelledby="pipeline-heading" className="border-t border-ink/10 py-16">
          <h2 id="pipeline-heading" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            How the book gets written
          </h2>
          <div className="mt-8 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {PIPELINE.map((col) => (
              <div key={col.title}>
                <h3 className="font-display text-lg font-semibold tracking-tight">{col.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/70">{col.body}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-ink/10 py-8 text-sm text-ink/70">Built for Razorpay Hackathon · Track 01</footer>
      </main>
    </>
  );
}

function Fact({ value, label, tone }: { value: string; label: string; tone?: "money" | "deny" }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("font-mono text-base font-semibold text-ink tnum", tone === "money" && "text-money", tone === "deny" && "text-deny")}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden="true">·</span>
  );
}
