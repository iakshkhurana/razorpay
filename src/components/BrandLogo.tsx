"use client";

import Link from "next/link";
import * as React from "react";
import { useT } from "@/lib/i18n/core";
import { nav } from "@/lib/i18n/strings/nav";
import { cn } from "@/lib/utils";

/**
 * The AgentGate brand, text only: a navy tile with the teal "AG" mark and the
 * wordmark beside it. Same API as the earlier image-based component so every
 * call site keeps working.
 *
 * - `chip`   — tile + wordmark for white or mist surfaces.
 * - `onDark` — tile + white wordmark for navy bars.
 * - `mark`   — the square tile only.
 */

export type BrandLogoVariant = "chip" | "onDark" | "mark";

export interface BrandLogoProps {
  variant?: BrandLogoVariant;
  size?: number;
  className?: string;
  /** wrap in a link to `href` (default "/"); pass null for a plain figure */
  href?: string | null;
  /** accessible name of the link / figure */
  label?: string;
  priority?: boolean;
}

/**
 * The mark: a gate. Two pillars, an arch, and the ledger line running through —
 * drawn inline so it is crisp at any size and needs no image asset. With a
 * label it is an image; without one it is decorative (the wordmark beside it
 * carries the name).
 */
function MarkTile({ size, label }: { size: number; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden", size >= 36 ? "rounded-xl" : "rounded-lg")}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 40 40" className="h-full w-full">
        <defs>
          <linearGradient id="ag-mark-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1B45B8" />
            <stop offset="1" stopColor="#0B1D3A" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx={size >= 36 ? 10 : 8} fill="url(#ag-mark-bg)" />
        {/* the gate: pillars + arch */}
        <path d="M11 30V19c0-6 4-9.5 9-9.5s9 3.5 9 9.5v11" fill="none" stroke="#2EC4E6" strokeWidth="2.6" strokeLinecap="round" />
        {/* the ledger line through the gate */}
        <path d="M8 30h24" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M16 24.5h8" stroke="#7FDBEE" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function BrandLogo({ variant = "chip", size = 40, className, href = "/", label = "AgentGate" }: BrandLogoProps) {
  const tn = useT(nav);
  const figure =
    variant === "mark" ? (
      <MarkTile size={size} label={label} />
    ) : (
      <span className="inline-flex items-center gap-2">
        <MarkTile size={size} />
        <span
          className={cn("font-display font-bold tracking-tight", variant === "onDark" ? "text-white" : "text-rzp-navy")}
          style={{ fontSize: Math.round(size * 0.5) }}
        >
          {label}
        </span>
      </span>
    );

  if (href === null) return <span className={cn("inline-flex shrink-0", className)}>{figure}</span>;

  return (
    <Link
      href={href}
      aria-label={label === "AgentGate" ? tn("brand.home") : label}
      className={cn(
        "inline-flex shrink-0 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
        className,
      )}
    >
      {figure}
    </Link>
  );
}
