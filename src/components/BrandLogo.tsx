import Link from "next/link";
import * as React from "react";
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

function MarkTile({ size, label }: { size: number; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center bg-rzp-navy font-display font-bold tracking-wide text-rzp-cyan ring-1 ring-white/10",
        size >= 36 ? "rounded-xl" : "rounded-lg",
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) }}
    >
      AG
    </span>
  );
}

export function BrandLogo({ variant = "chip", size = 40, className, href = "/", label = "AgentGate" }: BrandLogoProps) {
  const figure =
    variant === "mark" ? (
      <MarkTile size={size} label={label} />
    ) : (
      <span className="inline-flex items-center gap-2">
        <MarkTile size={size} label="" />
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
      aria-label={`${label} home`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
        className,
      )}
    >
      {figure}
    </Link>
  );
}
