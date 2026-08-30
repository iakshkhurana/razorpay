"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { api, type StatsResponse } from "@/lib/demo/client";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

export type ShellSection = "home" | "tower" | "onboard" | "simulator" | "evidence";

type IconProps = { className?: string };

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 10.5 12 4l8.5 6.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function TowerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <path d="M17 13.5v7M13.5 17h7" />
    </svg>
  );
}

function StoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5.5 12.5V20h13v-7.5" />
      <path d="M10 20v-4.5h4V20" />
    </svg>
  );
}

function ChatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8.5 9h7M8.5 12h4" />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 9.8" />
    </svg>
  );
}

interface NavItem {
  key: ShellSection;
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "home", href: "/", label: "Home", Icon: HomeIcon },
      { key: "tower", href: "/dashboard", label: "Control Tower", Icon: TowerIcon },
    ],
  },
  {
    label: "Sell",
    items: [
      { key: "onboard", href: "/onboard", label: "Onboard", Icon: StoreIcon },
      { key: "simulator", href: "/simulator", label: "Simulator", Icon: ChatIcon },
    ],
  },
  {
    label: "Proof",
    items: [{ key: "evidence", href: "/eval", label: "Evidence", Icon: ShieldIcon }],
  },
];

const ALL_ITEMS: readonly NavItem[] = NAV.flatMap((g) => g.items);

function sectionForPath(pathname: string | null): ShellSection | null {
  if (!pathname) return null;
  if (pathname === "/") return "home";
  const hit = ALL_ITEMS.find((i) => i.href !== "/" && pathname.startsWith(i.href));
  return hit?.key ?? null;
}

/* ------------------------------------------------------------------ */
/*  Stats polling (modes + merchant) shared by the chrome              */
/* ------------------------------------------------------------------ */

export interface ShellStats {
  stats: StatsResponse | null;
  /** true after a fetch failed and nothing newer has succeeded */
  offline: boolean;
}

/** Polls /api/stats on an interval. Initial render is deterministic (null) so hydration stays clean. */
export function useStatsPoll(intervalMs = 10_000): ShellStats {
  const [stats, setStats] = React.useState<StatsResponse | null>(null);
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await api.stats();
        if (cancelled) return;
        setStats(next);
        setOffline(false);
      } catch {
        if (!cancelled) setOffline(true);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return { stats, offline };
}

/* ------------------------------------------------------------------ */
/*  Top-bar pieces                                                     */
/* ------------------------------------------------------------------ */

const BAR_PILL = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium";

export function TestModePill({ className }: { className?: string }) {
  return (
    <span className={cn(BAR_PILL, "border-white/15 bg-white/10 text-white", className)}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-rzp-green shadow-[0_0_0_3px_rgba(18,183,106,0.25)]" />
      <span className="tracking-[0.12em]">TEST MODE</span>
    </span>
  );
}

export interface ModeBadgesProps {
  /** Voice agent state. Leave undefined to hide the Voice pill. */
  voice?: boolean;
  /** Pass modes from a shared poll; omit and the component polls /api/stats every 10s itself. */
  modes?: StatsResponse["modes"] | null;
  /** with `modes` supplied: true when the last poll failed */
  offline?: boolean;
  className?: string;
}

function BarPill({ dot, children, title }: { dot: string; children: React.ReactNode; title?: string }) {
  return (
    <span className={cn(BAR_PILL, "border-white/15 bg-white/10 text-white/90")} title={title}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      {children}
    </span>
  );
}

function ModeBadgesView({ voice, modes, offline, className }: ModeBadgesProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} aria-live="polite" aria-label="Runtime modes">
      {modes ? (
        <>
          <BarPill dot={modes.llm === "openai" ? "bg-rzp-green" : "bg-rzp-amber"} title={modes.llm === "openai" ? "Seller agent runs on OpenAI GPT-4o" : "Seller agent runs the scripted fallback"}>
            {modes.llm === "openai" ? "Seller · GPT-4o" : "Seller · Scripted"}
          </BarPill>
          <BarPill dot={modes.payments === "razorpay" ? "bg-rzp-blue" : "bg-rzp-amber"} title={modes.payments === "razorpay" ? "Payments on Razorpay test rails" : "Payments on the local mock adapter"}>
            {modes.payments === "razorpay" ? "Payments · Razorpay test" : "Payments · Mock"}
          </BarPill>
        </>
      ) : offline ? (
        <BarPill dot="bg-rzp-red" title="Could not reach /api/stats">
          Shop offline
        </BarPill>
      ) : (
        <>
          <span aria-hidden="true" className="h-7 w-28 animate-pulse rounded-full bg-white/10" />
          <span aria-hidden="true" className="h-7 w-36 animate-pulse rounded-full bg-white/10" />
        </>
      )}
      {typeof voice === "boolean" ? (
        <BarPill dot={voice ? "bg-rzp-green" : "bg-white/40"} title={voice ? "Voice agent is listening" : "Voice agent is off"}>
          {voice ? "Voice · on" : "Voice · off"}
        </BarPill>
      ) : null}
    </div>
  );
}

function ModeBadgesPolling(props: Omit<ModeBadgesProps, "modes" | "offline">) {
  const { stats, offline } = useStatsPoll(10_000);
  return <ModeBadgesView {...props} modes={stats?.modes ?? null} offline={offline} />;
}

/** Seller / Payments / Voice pills for the dark top bar. */
export function ModeBadges(props: ModeBadgesProps) {
  if (props.modes !== undefined) return <ModeBadgesView {...props} />;
  return <ModeBadgesPolling voice={props.voice} className={props.className} />;
}

export function initialsOf(name: string | null | undefined, fallback = "RH"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  const out = letters.join("");
  return out.length > 0 ? out : fallback;
}

export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  const label = name?.trim() || "Ramesh Handlooms";
  return (
    <span
      className={cn(
        "grid h-8 w-8 shrink-0 select-none place-items-center rounded-full bg-rzp-blue font-display text-xs font-bold text-white ring-2 ring-white/20",
        className,
      )}
      role="img"
      aria-label={`${label} — merchant account`}
      title={label}
    >
      {initialsOf(name)}
    </span>
  );
}

function WordMark() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center gap-2 rounded-md font-display text-lg font-bold tracking-tight text-white focus-visible:ring-offset-rzp-navy"
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

/* ------------------------------------------------------------------ */
/*  Sidebar + mobile row                                               */
/* ------------------------------------------------------------------ */

function NavLink({ item, active, compact }: { item: NavItem; active: boolean; compact: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
        compact && "md:justify-center lg:justify-start",
        active ? "bg-blue-50 text-blue-700" : "text-rzp-muted hover:bg-rzp-mist hover:text-rzp-text",
      )}
    >
      <item.Icon className={cn("h-5 w-5 shrink-0", active ? "text-blue-700" : "text-rzp-muted group-hover:text-rzp-text")} />
      <span className={cn(compact && "md:sr-only lg:not-sr-only")}>{item.label}</span>
    </Link>
  );
}

function Sidebar({ active }: { active: ShellSection | null }) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-rzp-border bg-white md:block md:w-16 lg:w-64">
      <nav aria-label="Primary" className="flex h-full flex-col gap-5 overflow-y-auto px-2 py-4 lg:px-3">
        {NAV.map((group) => (
          <div key={group.label}>
            <p className="hidden px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-rzp-muted lg:block">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <NavLink item={item} active={active === item.key} compact />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-auto hidden px-3 pb-2 lg:block">
          <p className="font-display text-sm font-semibold text-rzp-text">Har paisa, likha hua.</p>
          <p className="mt-1 text-xs text-rzp-muted">Razorpay Hackathon · Track 01</p>
        </div>
      </nav>
    </aside>
  );
}

function MobileNav({ active }: { active: ShellSection | null }) {
  return (
    <nav aria-label="Primary" className="sticky top-14 z-30 border-b border-rzp-border bg-white md:hidden">
      <ul className="scrollbar-thin flex gap-1 overflow-x-auto px-3 py-2">
        {ALL_ITEMS.map((item) => (
          <li key={item.key} className="shrink-0">
            <NavLink item={item} active={active === item.key} compact={false} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  The shell                                                          */
/* ------------------------------------------------------------------ */

export interface AppShellProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** right-aligned header actions (buttons, links, badges) */
  actions?: React.ReactNode;
  /** a full-width row rendered under the title — status pills, error lines, tabs */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  /** which nav item is active; inferred from the pathname when omitted */
  section?: ShellSection;
  /** voice agent state for the top-bar pill; undefined hides the pill */
  voice?: boolean;
  /** content width: default 1280px, narrow 880px, full = no cap */
  width?: "default" | "narrow" | "full";
  /** extra classes on the <main> content area */
  contentClassName?: string;
}

const WIDTH: Record<NonNullable<AppShellProps["width"]>, string> = {
  default: "max-w-[1280px]",
  narrow: "max-w-[880px]",
  full: "max-w-none",
};

/**
 * Dashboard-style chrome: navy top bar (wordmark · TEST MODE · mode pills · avatar),
 * white sidebar (icon rail under lg, horizontal row under md), page header and a
 * mist content area. Children render inside a <main>, so pages should not add their own.
 */
export function AppShell({ title, subtitle, actions, headerExtra, children, section, voice, width = "default", contentClassName }: AppShellProps) {
  const pathname = usePathname();
  const active = section ?? sectionForPath(pathname);
  const { stats, offline } = useStatsPoll(10_000);
  const merchantName = stats?.merchant?.name ?? null;
  const widthClass = WIDTH[width];

  return (
    <div className="flex min-h-screen flex-col bg-rzp-mist text-rzp-text">
      <header className="sticky top-0 z-40 h-14 bg-rzp-navy text-white">
        <div className="relative flex h-full items-center justify-between gap-3 px-4 sm:px-6">
          <WordMark />
          <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:block">
            <TestModePill />
          </div>
          <div className="flex items-center gap-2">
            <TestModePill className="sm:hidden" />
            <ModeBadges voice={voice} modes={stats?.modes ?? null} offline={offline} className="hidden md:flex" />
            <Avatar name={merchantName} />
          </div>
        </div>
      </header>

      <MobileNav active={active} />

      <div className="flex flex-1">
        <Sidebar active={active} />

        <div className="min-w-0 flex-1">
          <div className={cn("mx-auto w-full px-4 pb-4 pt-6 sm:px-6 lg:px-8", widthClass)}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold tracking-tight text-rzp-text sm:text-3xl">{title}</h1>
                {subtitle ? <p className="mt-1 max-w-2xl text-sm text-rzp-muted">{subtitle}</p> : null}
              </div>
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </div>
            {headerExtra ? <div className="mt-4">{headerExtra}</div> : null}
          </div>

          <main className={cn("mx-auto w-full px-4 pb-12 sm:px-6 lg:px-8", widthClass, contentClassName)}>{children}</main>
        </div>
      </div>
    </div>
  );
}
