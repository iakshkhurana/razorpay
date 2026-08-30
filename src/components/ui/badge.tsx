import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pill badge tones. Current: blue · green · amber · red · violet · gray.
 * Legacy tones (ink · money · turmeric · deny · action) map onto the same pills.
 * Text colours are darkened past the brand swatches so every tone clears 4.5:1 on white.
 */
export type BadgeTone = "blue" | "green" | "amber" | "red" | "violet" | "gray" | "ink" | "money" | "turmeric" | "deny" | "action";

const TONE: Record<BadgeTone, { pill: string; dot: string }> = {
  blue: { pill: "border-rzp-blue/25 bg-rzp-blue/10 text-rzp-blueDeep", dot: "bg-rzp-blue" },
  green: { pill: "border-rzp-green/30 bg-rzp-green/10 text-[#087443]", dot: "bg-rzp-green" },
  amber: { pill: "border-rzp-amber/40 bg-rzp-amber/10 text-[#9A4F00]", dot: "bg-rzp-amber" },
  red: { pill: "border-rzp-red/30 bg-rzp-red/10 text-[#B3262C]", dot: "bg-rzp-red" },
  violet: { pill: "border-rzp-violet/30 bg-rzp-violet/10 text-[#5A3DD8]", dot: "bg-rzp-violet" },
  gray: { pill: "border-rzp-border bg-rzp-mist2 text-rzp-muted", dot: "bg-rzp-muted" },
  /* legacy aliases */
  ink: { pill: "border-rzp-border bg-rzp-mist2 text-rzp-muted", dot: "bg-rzp-muted" },
  money: { pill: "border-rzp-green/30 bg-rzp-green/10 text-[#087443]", dot: "bg-rzp-green" },
  turmeric: { pill: "border-rzp-amber/40 bg-rzp-amber/10 text-[#9A4F00]", dot: "bg-rzp-amber" },
  deny: { pill: "border-rzp-red/30 bg-rzp-red/10 text-[#B3262C]", dot: "bg-rzp-red" },
  action: { pill: "border-rzp-blue/25 bg-rzp-blue/10 text-rzp-blueDeep", dot: "bg-rzp-blue" },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** leading status dot in the tone colour */
  dot?: boolean;
}

export function Badge({ tone = "gray", dot = false, className, children, ...props }: BadgeProps) {
  const t = TONE[tone];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", t.pill, className)}
      {...props}
    >
      {dot ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.dot)} /> : null}
      {children}
    </span>
  );
}
