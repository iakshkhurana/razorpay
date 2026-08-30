"use client";

import {
  LayoutGroup,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ACCENTS, clamp, type MotionAccent } from "./tokens";

export interface StickyFeatureItem {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  visual: ReactNode;
  accent?: MotionAccent;
}

export interface StickyFeaturesProps {
  items: StickyFeatureItem[];
  /** accessible name of the step rail */
  railLabel?: string;
  className?: string;
}

/* share of each item's scroll slice spent sliding the next panel in */
const SLIDE_SHARE = 0.45;

type StackVars = CSSProperties & { "--stack-h"?: string };

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/* ------------------------------------------------------------------ */
/*  One stacked panel                                                  */
/* ------------------------------------------------------------------ */

interface PanelProps {
  item: StickyFeatureItem;
  index: number;
  count: number;
  progress: MotionValue<number>;
}

function StackPanel({ item, index, count, progress }: PanelProps) {
  const slice = 1 / count;
  const first = index === 0;
  const last = index === count - 1;
  const inStart = index * slice;
  const inEnd = inStart + SLIDE_SHARE * slice;
  const outStart = (index + 1) * slice;
  const outEnd = outStart + SLIDE_SHARE * slice;

  const y = useTransform(progress, [inStart, inEnd], first ? ["0%", "0%"] : ["106%", "0%"]);
  const scale = useTransform(progress, [outStart, outEnd], last ? [1, 1] : [1, 0.94]);
  const dim = useTransform(progress, [outStart, outEnd], last ? [0, 0] : [0, 0.32]);
  const accent = ACCENTS[item.accent ?? "blue"];

  return (
    <motion.article
      id={item.id}
      style={{ y, scale, zIndex: index + 1 }}
      className={cn(
        "relative overflow-hidden rounded-3xl border border-[#E3EAF5] bg-white shadow-card",
        "lg:motion-safe:absolute lg:motion-safe:inset-0 lg:motion-safe:origin-top lg:motion-safe:shadow-lift",
        "max-lg:!transform-none motion-reduce:!transform-none",
      )}
      aria-labelledby={`${item.id}-title`}
    >
      <div className="grid h-full lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="order-2 flex flex-col justify-center gap-4 p-6 sm:p-8 lg:order-1 lg:p-10">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: accent.text }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent.dot }} aria-hidden="true" />
            {item.eyebrow}
          </p>
          <h3 id={`${item.id}-title`} className="font-display text-2xl font-bold tracking-tight text-[#0B1D3A] sm:text-3xl xl:text-4xl">
            {item.title}
          </h3>
          <p className="text-sm leading-relaxed text-[#5B6B8C] sm:text-base">{item.body}</p>
          <p className="font-mono text-xs text-[#5B6B8C] tnum">{`${pad(index + 1)} / ${pad(count)}`}</p>
        </div>
        <div
          className="relative order-1 flex min-h-[220px] items-center justify-center overflow-hidden p-6 sm:p-8 lg:order-2"
          style={{ backgroundColor: accent.tint }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: `radial-gradient(60% 60% at 68% 42%, ${accent.glow}, transparent 72%)` }}
          />
          <div className="relative w-full max-w-md">{item.visual}</div>
        </div>
      </div>
      <motion.div
        style={{ opacity: dim }}
        className="pointer-events-none absolute inset-0 hidden bg-[#0B1D3A] lg:motion-safe:block"
        aria-hidden="true"
      />
    </motion.article>
  );
}

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

/**
 * Scroll-driven stacked features. The section is items × 100vh tall; a sticky
 * viewport shows the current panel and each next panel slides up over the
 * previous one as the reader scrolls, with a left rail of step labels. Under
 * lg, or with reduced motion, the same DOM lays out as a plain vertical list.
 */
export function StickyFeatures({ items, railLabel = "Features", className }: StickyFeaturesProps) {
  const reduce = useReducedMotion();
  const uid = useId();
  const count = items.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (!Number.isFinite(v)) return;
    const next = clamp(Math.floor(v * count - 0.2), 0, count - 1);
    setActive((prev) => (prev === next ? prev : next));
  });

  const jumpTo = (index: number) => {
    const el = containerRef.current;
    if (!el || count < 2) return;
    const vh = window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const p = (index + 0.55) / count;
    window.scrollTo({ top: top + p * (count - 1) * vh, behavior: reduce ? "auto" : "smooth" });
  };

  if (count === 0) return null;

  const stackVars: StackVars = { "--stack-h": `${count * 100}vh` };

  return (
    <section className={cn("relative", className)}>
      <div ref={containerRef} className="lg:motion-safe:h-[var(--stack-h)]" style={stackVars}>
        <div className="lg:motion-safe:sticky lg:motion-safe:top-0 lg:motion-safe:flex lg:motion-safe:h-screen lg:motion-safe:items-center lg:motion-safe:overflow-hidden">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:motion-safe:grid lg:motion-safe:grid-cols-[240px_minmax(0,1fr)] lg:motion-safe:items-center lg:motion-safe:gap-12">
            <nav aria-label={railLabel} className="relative hidden lg:motion-safe:block">
              <div aria-hidden="true" className="absolute bottom-3 left-[17px] top-3 w-px bg-[#E3EAF5]">
                <motion.div style={{ scaleY: scrollYProgress }} className="h-full w-full origin-top bg-gradient-to-b from-[#17A9CC] to-[#2F6BFF]" />
              </div>
              <LayoutGroup id={uid}>
                <ol className="space-y-1">
                  {items.map((item, i) => {
                    const on = i === active;
                    const accent = ACCENTS[item.accent ?? "blue"];
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => jumpTo(i)}
                          aria-current={on ? "step" : undefined}
                          className={cn(
                            "relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6BFF] focus-visible:ring-offset-2",
                            on ? "text-[#0B1D3A]" : "text-[#5B6B8C] hover:text-[#14213D]",
                          )}
                        >
                          {on ? (
                            <motion.span
                              layoutId="rail-active"
                              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 40 }}
                              className="absolute inset-0 rounded-xl border border-[#E3EAF5] bg-white shadow-card"
                              aria-hidden="true"
                            />
                          ) : null}
                          <span
                            className="relative mt-1 h-3 w-3 shrink-0 rounded-full border-2 bg-white transition-colors"
                            style={{ borderColor: accent.dot, backgroundColor: on ? accent.dot : undefined }}
                            aria-hidden="true"
                          />
                          <span className="relative min-w-0">
                            <span className="block text-[11px] font-semibold uppercase tracking-[0.14em]" style={on ? { color: accent.text } : undefined}>
                              {item.eyebrow}
                            </span>
                            <span className="mt-0.5 block text-sm font-medium leading-snug">{item.title}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </LayoutGroup>
            </nav>

            <div className="space-y-6 lg:motion-safe:relative lg:motion-safe:h-[min(72vh,640px)] lg:motion-safe:space-y-0">
              {items.map((item, i) => (
                <StackPanel key={item.id} item={item} index={i} count={count} progress={scrollYProgress} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
