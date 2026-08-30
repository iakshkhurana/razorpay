"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TOUR_END_CARD, TOUR_STEPS, stepAt } from "@/lib/tour/steps";
import { clearTourStep, dispatchTourAction, readTourStep, tourHref, writeTourStep } from "@/lib/tour/client";

/**
 * The Grand Tour overlay. Mounted once in the root layout; visible only while
 * the URL carries ?tour=1. It owns the step position (sessionStorage), routes
 * to each step's page, tells the page to run its action, and auto-advances.
 * Pages never drive the tour — they only react to dispatched actions.
 *
 * Every tour navigation replaces history, so the whole tour occupies one
 * entry and the browser's Back button leaves it instead of bouncing forward.
 */

const TOTAL = TOUR_STEPS.length;
/** index value that means "show the end card" */
const END_INDEX = TOTAL;
/** breathing room after a page mounts before its action fires */
const DISPATCH_DELAY_MS = 600;

export function TourOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get("tour") === "1";

  // null until sessionStorage is read in an effect, so the first client render
  // matches the server (nothing) and never warns about hydration.
  const [index, setIndex] = useState<number | null>(null);
  const wasActiveRef = useRef<boolean | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(END_INDEX, i));
    if (clamped >= END_INDEX) clearTourStep();
    else writeTourStep(clamped);
    setIndex(clamped);
  }, []);

  const close = useCallback(() => {
    clearTourStep();
    setIndex(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tour");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, searchParams]);

  // A reload with ?tour=1 resumes the stored step; switching the tour on from
  // inside the app (the "Grand Tour" buttons) always starts at step 1.
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active) {
      setIndex(null);
      return;
    }
    if (wasActive === false) goTo(0);
    else setIndex(readTourStep());
  }, [active, goTo]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  // The engine: route to the step's page, fire its action, hold, advance.
  // A hidden tab pauses the hold so the tour never runs away unwatched.
  useEffect(() => {
    if (!active || index === null) return;
    const step = stepAt(index);
    if (!step) return;

    if (step.route !== pathname) {
      router.replace(tourHref(step));
      return;
    }
    const next = stepAt(index + 1);
    if (next && next.route !== step.route) router.prefetch(next.route);

    let dispatchTimer: number | null = null;
    let holdTimer: number | null = null;
    let remaining = step.hold_ms;
    let startedAt = 0;
    let holding = false;

    const startHold = () => {
      holding = true;
      if (document.hidden) return;
      startedAt = Date.now();
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        goTo(index + 1);
      }, remaining);
    };

    const pauseHold = () => {
      if (holdTimer === null) return;
      window.clearTimeout(holdTimer);
      holdTimer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };

    const onVisibility = () => {
      if (!holding) return;
      if (document.hidden) pauseHold();
      else if (holdTimer === null) startHold();
    };

    dispatchTimer = window.setTimeout(() => {
      dispatchTimer = null;
      dispatchTourAction(step);
      startHold();
    }, DISPATCH_DELAY_MS);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (dispatchTimer !== null) window.clearTimeout(dispatchTimer);
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, index, pathname, router, goTo]);

  // Keyboard users drive the tour from its primary button. The button persists
  // across steps, so focus only moves when the card appears or swaps to the end card.
  const shown = active && index !== null;
  const atEnd = index !== null && index >= END_INDEX;
  useEffect(() => {
    if (!shown) return;
    (atEnd ? restartRef : nextRef).current?.focus({ preventScroll: true });
  }, [shown, atEnd]);

  if (!active || index === null) return null;

  const step = stepAt(index);
  /* steps completed so far, out of TOTAL — the end card shows a full line */
  const progress = step ? step.n : TOTAL;
  const progressPct = Math.round((progress / TOTAL) * 100);

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div className="absolute inset-0 bg-rzp-navy/20" aria-hidden="true" />
      <aside
        aria-label="Grand Tour"
        className="glass pointer-events-auto absolute inset-x-4 bottom-20 overflow-hidden rounded-2xl shadow-lift sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[28rem]"
      >
        <div
          className="h-1 w-full bg-rzp-blue/15"
          role="progressbar"
          aria-label="Tour progress"
          aria-valuemin={0}
          aria-valuemax={TOTAL}
          aria-valuenow={progress}
          aria-valuetext={`Step ${progress} of ${TOTAL}`}
        >
          <div className="h-full rounded-r-full bg-rzp-blue transition-[width] duration-500 ease-out" style={{ width: `${progressPct}%` }} />
        </div>

        {step ? (
          <div className="px-5 pb-4 pt-4">
            <div className="flex items-center justify-between gap-4">
              <p className="inline-flex items-center gap-2 rounded-full bg-rzp-blue/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rzp-blueDeep">
                Grand Tour
                <span className="font-mono normal-case tracking-normal tnum">
                  {step.n} / {TOTAL}
                </span>
              </p>
              <CloseButton onClick={close} />
            </div>

            <p aria-live="polite" className="mt-3 font-display text-xl font-semibold leading-snug tracking-tight text-rzp-text sm:text-2xl">
              {step.caption}
            </p>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {TOUR_STEPS.map((s, i) => (
                  <span
                    key={s.n}
                    className={cn(
                      "block h-1.5 rounded-full transition-[width,background-color] duration-300",
                      i === index ? "w-4 bg-rzp-blue" : i < index ? "w-1.5 bg-rzp-blue/50" : "w-1.5 bg-rzp-navy/15",
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" className="rounded-full px-3.5" onClick={() => goTo(index - 1)} disabled={index === 0}>
                  Back
                </Button>
                <Button ref={nextRef} type="button" variant="primary" size="sm" className="rounded-full px-4" onClick={() => goTo(index + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 pb-5 pt-4">
            <div className="flex items-start justify-between gap-4">
              <p className="inline-flex items-center gap-2 rounded-full bg-rzp-green/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#087443]">
                Grand Tour · complete
              </p>
              <CloseButton onClick={close} />
            </div>
            <p aria-live="polite" className="mt-3 font-display text-3xl font-bold tracking-tight text-rzp-text">
              {TOUR_END_CARD}
            </p>
            <p className="mt-2 text-sm text-rzp-muted">Every rupee your AI sells — explained, bounded, and written down.</p>
            <div className="mt-5 flex items-center gap-2">
              <Button ref={restartRef} type="button" variant="primary" size="md" className="rounded-full px-5" onClick={() => goTo(0)}>
                Restart tour
              </Button>
              <Button type="button" variant="secondary" size="md" className="rounded-full px-5" onClick={close}>
                Close tour
              </Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close tour"
      title="Close tour (Esc)"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-rzp-muted transition-colors hover:bg-rzp-navy/10 hover:text-rzp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
