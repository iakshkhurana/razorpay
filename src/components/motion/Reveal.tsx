"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { EASE_OUT } from "./tokens";

export interface RevealProps {
  children: ReactNode;
  /** seconds to wait once in view — stagger siblings with 0.08, 0.16 … */
  delay?: number;
  /** starting offset in px (slides up to 0) */
  y?: number;
  /** reveal once (default) or every time the block enters the viewport */
  once?: boolean;
  /** fraction of the block that must be visible before it reveals */
  amount?: number;
  className?: string;
}

/**
 * Fade-up when the block scrolls into view. Server markup carries the hidden
 * state, the client animates it in; with reduced motion the block is shown
 * instantly on mount.
 */
export function Reveal({ children, delay = 0, y = 24, once = true, amount = 0.2, className }: RevealProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, amount });
  const shown = inView || reduce === true;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={reduce ? { duration: 0 } : { duration: 0.6, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
