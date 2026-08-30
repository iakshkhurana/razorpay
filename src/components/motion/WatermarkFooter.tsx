"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "./tokens";

export interface WatermarkFooterProps {
  /** the giant word(s) — usually the brand */
  text: string;
  /** image painted through the letters, e.g. "/images/industry-fuel.jpg" */
  image: string;
  /** uppercase (default) or as given */
  uppercase?: boolean;
  /** font-size, default "18vw" */
  size?: string;
  className?: string;
}

/*
 * Solid navy first; the image only paints through the letters where
 * background-clip:text is supported. Hoisted + deduped by React via href.
 */
const WATERMARK_CSS = `
.ag-watermark{color:#0B1D3A;background-size:cover;background-position:center;background-repeat:no-repeat}
@supports (background-clip:text) or (-webkit-background-clip:text){
.ag-watermark{-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
}`;

/**
 * Giant display text cropped at the page's bottom edge like a watermark, the
 * photo showing through the letters. Decorative — hidden from assistive tech.
 */
export function WatermarkFooter({ text, image, uppercase = true, size = "18vw", className }: WatermarkFooterProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const shown = inView || reduce === true;

  const style: CSSProperties = {
    backgroundImage: `url("${image}")`,
    fontSize: size,
  };

  return (
    <div ref={ref} aria-hidden="true" className={cn("relative select-none overflow-hidden", className)}>
      <style href="agentgate-watermark" precedence="default">
        {WATERMARK_CSS}
      </style>
      <motion.div
        initial={{ opacity: 0, y: "14%" }}
        animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: "14%" }}
        transition={reduce ? { duration: 0 } : { duration: 0.9, ease: EASE_OUT }}
        className={cn(
          "ag-watermark -mb-[0.26em] whitespace-nowrap text-center font-display font-bold leading-[0.8] tracking-[-0.045em]",
          uppercase && "uppercase",
        )}
        style={style}
      >
        {text}
      </motion.div>
    </div>
  );
}
