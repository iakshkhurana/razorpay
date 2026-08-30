"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BrowserFrameProps {
  children: ReactNode;
  /** shown in the address pill, e.g. "agentgate.app/dashboard" */
  url: string;
  /** light chrome (default) or navy for dark mocks */
  tone?: "light" | "navy";
  className?: string;
  /** optional accessible name for the mock; the chrome itself is decorative */
  label?: string;
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "left" ? <path d="m10 3.5-4.5 4.5L10 12.5" /> : <path d="m6 3.5 4.5 4.5L6 12.5" />}
    </svg>
  );
}

/**
 * A mock browser window — three dots, back/forward, an address pill — for
 * framing a UI mock. Pure markup, no hooks.
 */
export function BrowserFrame({ children, url, tone = "light", className, label }: BrowserFrameProps) {
  const navy = tone === "navy";
  return (
    <figure
      aria-label={label}
      className={cn(
        "overflow-hidden rounded-2xl border shadow-lift",
        navy ? "border-white/10 bg-[#0B1D3A] text-white" : "border-[#E3EAF5] bg-white text-[#14213D]",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 border-b px-3.5 py-2.5",
          navy ? "border-white/10 bg-white/5" : "border-[#E3EAF5] bg-[#F3F7FF]",
        )}
        aria-hidden="true"
      >
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        </span>
        <span className={cn("hidden items-center gap-1 sm:flex", navy ? "text-white/40" : "text-[#5B6B8C]/70")}>
          <Chevron dir="left" />
          <Chevron dir="right" />
        </span>
        <span
          className={cn(
            "mx-auto flex min-w-0 max-w-md flex-1 items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] sm:text-xs",
            navy ? "border-white/10 bg-white/10 text-white/80" : "border-[#E3EAF5] bg-white text-[#5B6B8C]",
          )}
        >
          <LockGlyph />
          <span className="truncate">{url}</span>
        </span>
        <span className="hidden w-10 shrink-0 sm:block" />
      </div>
      <div className="relative">{children}</div>
    </figure>
  );
}
