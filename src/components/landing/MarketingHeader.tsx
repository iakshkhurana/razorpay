"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const REPO_URL = "https://github.com/iakshkhurana/razorpay";

type NavItem = { label: string; href: string; kind: "hash" | "route" | "external" };

const NAV: readonly NavItem[] = [
  { label: "Product", href: "#product", kind: "hash" },
  { label: "How it works", href: "#how", kind: "hash" },
  { label: "Evidence", href: "/eval", kind: "route" },
  { label: "Docs", href: REPO_URL, kind: "external" },
];

const NAV_LINK =
  "rounded-lg px-3 py-1.5 text-sm font-medium text-rzp-navy/80 transition-colors hover:bg-white/60 hover:text-rzp-navy " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2";

/* deep blue keeps white button text above 4.5:1 on every background */
const PRIMARY = "border-rzp-blueDeep bg-rzp-blueDeep hover:border-[#1A54AB] hover:bg-[#1A54AB]";

export function WordMark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md font-display text-lg font-bold tracking-tight text-rzp-navy",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
        className,
      )}
      aria-label="AgentGate home"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="6" fill="#3395FF" />
        <path d="M7 16.5 12 6l5 10.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.2 13h5.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>AgentGate</span>
    </Link>
  );
}

function NavLink({ item, className, onNavigate }: { item: NavItem; className?: string; onNavigate?: () => void }) {
  if (item.kind === "route") {
    return (
      <Link href={item.href} className={className} onClick={onNavigate}>
        {item.label}
      </Link>
    );
  }
  if (item.kind === "external") {
    return (
      <a href={item.href} className={className} target="_blank" rel="noreferrer noopener" onClick={onNavigate}>
        {item.label}
        <span className="sr-only"> (opens GitHub in a new tab)</span>
      </a>
    );
  }
  return (
    <a href={item.href} className={className} onClick={onNavigate}>
      {item.label}
    </a>
  );
}

/**
 * Marketing site header: transparent over the hero, frosted white once the
 * page scrolls. Collapses to a disclosure menu under md.
 */
export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const frosted = scrolled || open;
  const close = () => setOpen(false);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 h-16 border-b transition-[background-color,border-color,box-shadow] duration-200",
        frosted ? "border-rzp-border bg-white/80 shadow-[0_4px_20px_rgba(20,33,61,0.06)] backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <WordMark />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink key={item.label} item={item} className={NAV_LINK} />
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/dashboard" className={buttonClasses({ variant: "secondary", size: "sm", className: "h-9 px-3.5 text-sm" })}>
            Open Control Tower
          </Link>
          <Link href="/onboard" className={buttonClasses({ variant: "primary", size: "sm", className: cn("h-9 px-3.5 text-sm", PRIMARY) })}>
            Onboard a shop
          </Link>
        </div>

        <button
          type="button"
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-lg text-rzp-navy md:hidden",
            "hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
          )}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      <div id={menuId} hidden={!open} className="border-t border-rzp-border bg-white/95 shadow-card backdrop-blur-md md:hidden">
        <nav aria-label="Primary (mobile)" className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
          {NAV.map((item) => (
            <NavLink key={item.label} item={item} className={cn(NAV_LINK, "px-3 py-2.5 text-base")} onNavigate={close} />
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-rzp-border pt-3">
            <Link href="/dashboard" onClick={close} className={buttonClasses({ variant: "secondary", size: "md" })}>
              Open Control Tower
            </Link>
            <Link href="/onboard" onClick={close} className={buttonClasses({ variant: "primary", size: "md", className: PRIMARY })}>
              Onboard a shop
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
