"use client";

import { motion, useAnimationFrame, useMotionValue, useReducedMotion } from "framer-motion";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MarqueeProps {
  /** strings become pills; any other node renders as given */
  items: ReactNode[];
  /** pixels per second, default 40 */
  speed?: number;
  /** accessible name for the strip */
  label?: string;
  /** pill look for string items: light (default) or on navy */
  tone?: "light" | "navy";
  className?: string;
}

const MASK = "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)";

/**
 * A gentle, endless horizontal scroll of pills. Pauses on hover and while a
 * child has focus. Under reduced motion the strip stands still and scrolls
 * natively; the duplicate run used for looping is hidden there.
 */
export function Marquee({ items, speed = 40, label = "Highlights", tone = "light", className }: MarqueeProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const trackRef = useRef<HTMLUListElement>(null);
  const paused = useRef(false);

  useAnimationFrame((_, delta) => {
    if (reduce || paused.current) return;
    const track = trackRef.current;
    if (!track) return;
    const half = track.scrollWidth / 2;
    if (!half) return;
    let next = x.get() - (speed * delta) / 1000;
    if (next <= -half) next += half;
    x.set(next);
  });

  const maskStyle: CSSProperties = { WebkitMaskImage: MASK, maskImage: MASK };
  const pill =
    tone === "navy"
      ? "border-white/15 bg-white/10 text-white"
      : "border-[#E3EAF5] bg-white text-[#14213D] shadow-sm";

  const renderItem = (item: ReactNode, key: string, clone: boolean) => (
    <li key={key} aria-hidden={clone || undefined} className={cn("shrink-0", clone && "motion-reduce:hidden")}>
      {typeof item === "string" ? (
        <span className={cn("inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium", pill)}>
          <span className="h-1.5 w-1.5 rounded-full bg-[#17A9CC]" aria-hidden="true" />
          {item}
        </span>
      ) : (
        item
      )}
    </li>
  );

  return (
    <div
      role="region"
      aria-label={label}
      className={cn("scrollbar-thin relative overflow-hidden motion-reduce:overflow-x-auto", className)}
      style={maskStyle}
      onMouseEnter={() => {
        paused.current = true;
      }}
      onMouseLeave={() => {
        paused.current = false;
      }}
      onFocusCapture={() => {
        paused.current = true;
      }}
      onBlurCapture={() => {
        paused.current = false;
      }}
    >
      <motion.ul ref={trackRef} style={{ x }} className="flex w-max items-center gap-3 py-2 pr-3">
        {items.map((item, i) => renderItem(item, `a-${i}`, false))}
        {items.map((item, i) => renderItem(item, `b-${i}`, true))}
      </motion.ul>
    </div>
  );
}
