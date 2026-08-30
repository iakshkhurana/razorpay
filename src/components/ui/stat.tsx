import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

export type StatTone = "default" | "blue" | "green" | "amber" | "red" | "violet";

export interface StatDelta {
  /** e.g. "+12.6%" or "₹350" — shown in a small pill next to the value */
  label: string;
  direction?: "up" | "down" | "flat";
}

export interface StatProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  label: React.ReactNode;
  /** already formatted — pass formatINR(paise), "0", "✓ Intact" … */
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** colours the value */
  tone?: StatTone;
  delta?: StatDelta;
  /** renders skeletons in place of value and hint */
  loading?: boolean;
  /** optional line icon rendered top-right, 20px */
  icon?: React.ReactNode;
  /** wrap in a Card (default) or render bare for use inside your own card */
  bare?: boolean;
}

const VALUE_TONE: Record<StatTone, string> = {
  default: "text-rzp-text",
  blue: "text-rzp-blueDeep",
  green: "text-[#087443]",
  amber: "text-[#9A4F00]",
  red: "text-[#B3262C]",
  violet: "text-[#5A3DD8]",
};

const DELTA_TONE: Record<NonNullable<StatDelta["direction"]>, string> = {
  up: "border-rzp-green/30 bg-rzp-green/10 text-[#087443]",
  down: "border-rzp-red/30 bg-rzp-red/10 text-[#B3262C]",
  flat: "border-rzp-border bg-rzp-mist2 text-rzp-muted",
};

function DeltaArrow({ direction }: { direction: NonNullable<StatDelta["direction"]> }) {
  if (direction === "flat") return null;
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {direction === "up" ? <path d="M2 8.5 6 4l4 4.5" /> : <path d="M2 3.5 6 8l4-4.5" />}
    </svg>
  );
}

/**
 * KPI tile in the dashboard pattern: small label on top, a big tabular mono value,
 * a muted hint underneath, and an optional delta pill beside the value.
 */
export function Stat({ label, value, hint, tone = "default", delta, loading = false, icon, bare = false, className, ...props }: StatProps) {
  return (
    <div
      className={cn(
        !bare && "rounded-2xl border border-rzp-border bg-white px-5 py-4 shadow-card",
        "min-w-0",
        className,
      )}
      aria-busy={loading || undefined}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rzp-muted">{label}</p>
        {icon ? <span className="shrink-0 text-rzp-blue [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">{icon}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {loading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <p className={cn("min-w-0 break-words font-mono text-3xl font-semibold leading-none tracking-tight tnum", VALUE_TONE[tone])}>{value}</p>
        )}
        {!loading && delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tnum",
              DELTA_TONE[delta.direction ?? "flat"],
            )}
          >
            <DeltaArrow direction={delta.direction ?? "flat"} />
            {delta.label}
          </span>
        ) : null}
      </div>
      {hint !== undefined ? (
        loading ? <Skeleton className="mt-2 h-3 w-36" /> : <p className="mt-2 text-xs text-rzp-muted">{hint}</p>
      ) : null}
    </div>
  );
}
