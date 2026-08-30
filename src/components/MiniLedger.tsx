"use client";

import confetti from "canvas-confetti";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/money";
import { VerdictStamp, type StampKind } from "./VerdictStamp";

/**
 * The landing-page signature: a small open account book that writes three
 * entries by itself — ALLOW, COUNTER, PAID — then clears and starts again.
 * Pure presentation; nothing here touches the server.
 */

interface MiniEntry {
  id: string;
  line: string;
  note: string;
  amount_paise: number;
  verdict: StampKind;
}

const BUNDLE_PAISE = 184_900;
const BANARASI_PAISE = 499_900;
const MANDATE_CAP_PAISE = 200_000;

const ENTRIES: readonly MiniEntry[] = [
  {
    id: "allow",
    line: "Cotton Handloom Saree + blouse",
    note: "Bundle offer, inside every rule",
    amount_paise: BUNDLE_PAISE,
    verdict: "ALLOW",
  },
  {
    id: "counter",
    line: `Banarasi try on a ${formatINR(MANDATE_CAP_PAISE)} mandate`,
    note: "Above the cap — countered to fit",
    amount_paise: BANARASI_PAISE,
    verdict: "COUNTER",
  },
  {
    id: "paid",
    line: "Payment received, saree + blouse",
    note: "Written to the chain, explained",
    amount_paise: BUNDLE_PAISE,
    verdict: "PAID",
  },
];

/** One stage = how many lines are on the page and how many carry a stamp. */
interface Stage {
  shown: number;
  stamped: number;
  hold_ms: number;
}

const STAGES: readonly Stage[] = [
  { shown: 0, stamped: 0, hold_ms: 500 },
  { shown: 1, stamped: 0, hold_ms: 750 },
  { shown: 1, stamped: 1, hold_ms: 1200 },
  { shown: 2, stamped: 1, hold_ms: 750 },
  { shown: 2, stamped: 2, hold_ms: 1200 },
  { shown: 3, stamped: 2, hold_ms: 750 },
  { shown: 3, stamped: 3, hold_ms: 3400 },
];

const FINAL_STAGE = STAGES.length - 1;

const CONFETTI_COLOURS = ["#1E6E52", "#B77913", "#6B5CA5", "#28356A"];

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

export interface MiniLedgerProps {
  /** Bump this to restart the cycle from the first entry. */
  restartKey?: number;
  className?: string;
}

export function MiniLedger({ restartKey = 0, className }: MiniLedgerProps) {
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const paidStampRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = reducedMotionQuery();
    if (!mq) return;
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    setStage(0);
  }, [restartKey]);

  useEffect(() => {
    if (reduced || paused) return;
    const current = STAGES[stage] ?? STAGES[0];
    const t = window.setTimeout(() => {
      setStage((s) => (s + 1) % STAGES.length);
    }, current.hold_ms);
    return () => window.clearTimeout(t);
  }, [stage, paused, reduced]);

  useEffect(() => {
    if (reduced || stage !== FINAL_STAGE) return;
    const rect = paidStampRef.current?.getBoundingClientRect();
    const origin =
      rect && window.innerWidth > 0 && window.innerHeight > 0
        ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight }
        : { x: 0.5, y: 0.5 };
    try {
      void confetti({
        particleCount: 36,
        spread: 55,
        startVelocity: 22,
        gravity: 0.9,
        ticks: 110,
        scalar: 0.8,
        colors: CONFETTI_COLOURS,
        origin,
        disableForReducedMotion: true,
      });
    } catch {
      /* confetti is decoration; the book keeps writing without it */
    }
  }, [stage, reduced]);

  const view = reduced ? STAGES[FINAL_STAGE] : (STAGES[stage] ?? STAGES[0]);
  const animate = !reduced;

  return (
    <div
      role="img"
      aria-label="Ledger writing three entries: allowed, countered, paid"
      className={cn("ledger-spine rounded-xl border border-ink/10 bg-white/50 pl-[6px]", className)}
    >
      <div aria-hidden="true" className="ruled-paper rounded-r-xl">
        <div className="flex items-baseline justify-between px-4 pt-3 text-[11px] uppercase tracking-[0.18em] text-ink/70 sm:px-5">
          <span className="font-display font-semibold">Ramesh Handlooms · bahi-khata</span>
          <span className="font-mono tnum">page 1</span>
        </div>
        <ol className="mt-1 min-h-[13.5rem] divide-y divide-ink/5">
          {ENTRIES.slice(0, view.shown).map((e, i) => {
            const stamped = i < view.stamped;
            return (
              <li key={e.id} className={cn("px-4 py-3.5 sm:px-5", animate && "animate-write-in")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-base leading-snug sm:text-lg">{e.line}</p>
                    <p className="mt-1 text-xs text-ink/70">{e.note}</p>
                  </div>
                  <div
                    ref={e.verdict === "PAID" ? paidStampRef : undefined}
                    className="flex shrink-0 flex-col items-end gap-1.5"
                  >
                    <span className={cn("font-mono text-base tnum sm:text-lg", e.verdict === "PAID" && "text-money")}>
                      {formatINR(e.amount_paise)}
                    </span>
                    <span className="flex h-5 items-center">
                      {stamped ? <VerdictStamp kind={e.verdict} size="sm" animate={animate} /> : null}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
