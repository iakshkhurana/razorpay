"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type StampKind = "ALLOW" | "COUNTER" | "GATE" | "DENY" | "PAID" | "FAILED" | "HELD" | "INFO";

const STYLE: Record<StampKind, { label: string; className: string }> = {
  ALLOW: { label: "ALLOW", className: "border-money text-money" },
  PAID: { label: "PAID", className: "border-money text-money" },
  COUNTER: { label: "COUNTER", className: "border-turmeric text-turmeric" },
  HELD: { label: "HELD", className: "border-turmeric text-turmeric" },
  GATE: { label: "OWNER'S CALL", className: "border-violet text-violet" },
  DENY: { label: "DENY", className: "border-deny text-deny" },
  FAILED: { label: "FAILED", className: "border-deny text-deny" },
  INFO: { label: "NOTED", className: "border-ink/40 text-ink/70" },
};

const SIZE = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-xs",
  lg: "px-3 py-1 text-sm",
};

export function stampKindFor(verdict: string): StampKind {
  return (verdict in STYLE ? verdict : "INFO") as StampKind;
}

export interface VerdictStampProps {
  kind: StampKind | string;
  size?: keyof typeof SIZE;
  animate?: boolean;
  className?: string;
  /** replaces the English label (a translated stamp); colours still follow `kind` */
  label?: string;
}

/**
 * Rubber-stamp badge: uppercase, letterspaced, 1.5px border, rotated -2°,
 * pressed on with the stamp animation. The label is always text — never colour alone.
 */
export function VerdictStamp({ kind, size = "md", animate = true, className, label }: VerdictStampProps) {
  const k = stampKindFor(kind);
  const s = STYLE[k];
  return (
    <span
      role="status"
      className={cn(
        "inline-block select-none whitespace-nowrap rounded-[3px] font-display font-bold uppercase tracking-[0.18em]",
        "-rotate-2 border-[1.5px] bg-paper/70",
        animate && "animate-stamp",
        s.className,
        SIZE[size],
        className,
      )}
      style={{ borderStyle: "solid" }}
    >
      {label ?? s.label}
    </span>
  );
}
