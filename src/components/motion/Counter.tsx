"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { groupIndian } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface CounterProps {
  /** final number — rupees, percentages, counts; not paise */
  value: number;
  prefix?: string;
  suffix?: string;
  /** seconds, default 1.6 */
  duration?: number;
  /** fixed decimals; defaults to the decimals in `value` (max 2) */
  decimals?: number;
  className?: string;
}

function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const frac = n.toString().split(".")[1] ?? "";
  return Math.min(2, frac.length);
}

/** "12,34,567.50" — Indian grouping on the integer part once it passes 999. */
export function formatCount(n: number, decimals: number): string {
  const sign = n < 0 ? "-" : "";
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = groupIndian(Number(int));
  return frac ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}

/**
 * Counts up from 0 when it scrolls into view. The visible digits are hidden
 * from assistive tech; a screen-reader-only span always carries the final value.
 */
export function Counter({ value, prefix = "", suffix = "", duration = 1.6, decimals, className }: CounterProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [shown, setShown] = useState(0);
  const latest = useRef(0);
  const places = decimals ?? decimalsOf(value);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      latest.current = value;
      setShown(value);
      return;
    }
    const controls = animate(latest.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        latest.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  const final = `${prefix}${formatCount(value, places)}${suffix}`;

  return (
    <span ref={ref} className={cn("tnum", className)}>
      <span aria-hidden="true">{`${prefix}${formatCount(shown, places)}${suffix}`}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
