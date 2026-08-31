"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { AgentVoiceToggle } from "@/components/AgentVoiceToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { api, type StatsResponse } from "@/lib/demo/client";
import { useT } from "@/lib/i18n/core";
import { common } from "@/lib/i18n/strings/common";
import { nav } from "@/lib/i18n/strings/nav";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

export type ShellSection = "home" | "tower" | "onboard" | "simulator" | "evidence" | "developers" | "metrics";

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

function CodeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 8-4.5 4L8 16M16 8l4.5 4L16 16M13.5 5l-3 14" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function MenuIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

type CommonKey = keyof typeof common.en;

interface NavItem {
  key: ShellSection;
  href: string;
  labelKey: CommonKey;
  Icon: (props: IconProps) => React.ReactElement;
}

interface NavGroup {
  labelKey: CommonKey;
  items: NavItem[];
}

const NAV: readonly NavGroup[] = [
  {
    labelKey: "app.group.overview",
    items: [
      { key: "home", href: "/", labelKey: "app.home", Icon: HomeIcon },
      { key: "tower", href: "/dashboard", labelKey: "app.tower", Icon: TowerIcon },
    ],
  },
  {
    labelKey: "app.group.sell",
    items: [
      { key: "onboard", href: "/onboard", labelKey: "app.onboard", Icon: StoreIcon },
      { key: "simulator", href: "/simulator", labelKey: "app.simulator", Icon: ChatIcon },
    ],
  },
  {
    labelKey: "app.group.proof",
    items: [{ key: "evidence", href: "/eval", labelKey: "app.evidence", Icon: ShieldIcon }],
  },
  {
    labelKey: "app.group.build",
    items: [
      { key: "developers", href: "/developers", labelKey: "app.developers", Icon: CodeIcon },
      { key: "metrics", href: "/metrics", labelKey: "app.metrics", Icon: PulseIcon },
    ],
  },
];

function PulseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
    </svg>
  );
}

const ALL_ITEMS: readonly NavItem[] = NAV.flatMap((g) => g.items);

const DEFAULT_MERCHANT = "Ramesh Handlooms";

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

export interface TestModePillProps {
  className?: string;
  /** "dark" sits on navy bars; "light" on white surfaces */
  tone?: "dark" | "light";
  /**
   * Payment rail to name after the label: "razorpay" | "mock". Pass null while
   * /api/stats is still loading (shows "Checking"); leave undefined for the
   * plain "TEST MODE" pill.
   */
  payments?: StatsResponse["modes"]["payments"] | null;
}

/** "● TEST MODE · Razorpay" — the green dot pulses; the rail name follows /api/stats. */
export function TestModePill({ className, tone = "dark", payments }: TestModePillProps) {
  const t = useT(common);
  const tn = useT(nav);
  const rail = payments === undefined ? null : payments === null ? tn("pill.checking") : payments === "razorpay" ? tn("pill.razorpay") : tn("pill.mock");
  const title = payments === undefined ? undefined : payments === "razorpay" ? tn("pill.title.razorpay") : payments === "mock" ? tn("pill.title.mock") : tn("pill.title.checking");
  return (
    <span
      className={cn(BAR_PILL, tone === "dark" ? "border-white/15 bg-white/10 text-white" : "border-rzp-border bg-white text-rzp-navy shadow-sm", className)}
      title={title}
      data-payments={payments ?? undefined}
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-rzp-green animate-dot-pulse" />
      <span className="tracking-[0.12em]">{t("nav.testMode")}</span>
      {rail ? (
        <>
          <span aria-hidden="true" className={tone === "dark" ? "text-white/40" : "text-rzp-muted"}>
            ·
          </span>
          <span className={cn("tracking-normal", payments === null && "opacity-70")} aria-live="polite">
            {rail}
          </span>
        </>
      ) : null}
    </span>
  );
}

export interface NotchTabProps {
  /** colour of the bar the tab hangs from */
  tone?: "light" | "dark";
  className?: string;
  children: React.ReactNode;
}

type NotchStyle = React.CSSProperties & { "--notch-bg"?: string };

/**
 * Downward tab cut from the bottom edge of a bar. Place inside a `relative`
 * bar; it centres itself and overlaps the bar's border so the notch reads as
 * one shape.
 */
export function NotchTab({ tone = "light", className, children }: NotchTabProps) {
  const style: NotchStyle = { "--notch-bg": tone === "dark" ? "#0B1D3A" : "#FFFFFF" };
  return (
    <div
      className={cn(
        "notch-tab absolute left-1/2 top-[calc(100%-1px)] z-10 -translate-x-1/2 px-2.5 pb-2 pt-1",
        tone === "light" && "shadow-[0_10px_22px_-10px_rgba(11,29,58,0.3)]",
        className,
      )}
      style={style}
    >
      {children}
    </div>
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
    <span className={cn(BAR_PILL, "border-rzp-border bg-rzp-mist text-rzp-text")} title={title}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      {children}
    </span>
  );
}

function ModeBadgesView({ voice, modes, offline, className }: ModeBadgesProps) {
  const t = useT(common);
  return (
    <div className={cn("flex items-center gap-2", className)} aria-live="polite" aria-label={t("shell.runtimeModes")}>
      {modes ? (
        <>
          <BarPill dot={modes.llm === "openai" ? "bg-rzp-green" : "bg-rzp-amber"} title={modes.llm === "openai" ? t("shell.sellerGptTitle") : t("shell.sellerScriptedTitle")}>
            {modes.llm === "openai" ? t("shell.sellerGpt") : t("shell.sellerScripted")}
          </BarPill>
          <BarPill dot={modes.payments === "razorpay" ? "bg-rzp-cyan" : "bg-rzp-amber"} title={modes.payments === "razorpay" ? t("shell.paymentsRazorpayTitle") : t("shell.paymentsMockTitle")}>
            {modes.payments === "razorpay" ? t("shell.paymentsRazorpay") : t("shell.paymentsMock")}
          </BarPill>
        </>
      ) : offline ? (
        <BarPill dot="bg-rzp-red" title={t("shell.shopOfflineTitle")}>
          {t("shell.shopOffline")}
        </BarPill>
      ) : (
        <>
          <span aria-hidden="true" className="h-7 w-28 animate-pulse rounded-full bg-rzp-mist2" />
          <span aria-hidden="true" className="h-7 w-36 animate-pulse rounded-full bg-rzp-mist2" />
        </>
      )}
      {typeof voice === "boolean" ? (
        <BarPill dot={voice ? "bg-rzp-green" : "bg-rzp-muted/40"} title={voice ? t("voice.listening") : t("voice.idle")}>
          {voice ? t("voice.on") : t("voice.off")}
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
  const t = useT(common);
  const label = name?.trim() || DEFAULT_MERCHANT;
  return (
    <span
      className={cn(
        "grid h-8 w-8 shrink-0 select-none place-items-center rounded-full bg-gradient-to-br from-rzp-blue to-rzp-teal font-display text-xs font-bold text-white ring-2 ring-white/20",
        className,
      )}
      role="img"
      aria-label={t("shell.merchantAccount", { name: label })}
      title={label}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar pieces                                                     */
/* ------------------------------------------------------------------ */

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white";

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const t = useT(common);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
        FOCUS_RING,
        active ? "bg-rzp-ice text-rzp-blueDeep shadow-sm" : "text-rzp-muted hover:bg-rzp-mist hover:text-rzp-text",
      )}
    >
      <item.Icon className={cn("h-5 w-5 shrink-0", active ? "text-rzp-blue" : "text-rzp-muted group-hover:text-rzp-text")} />
      <span>{t(item.labelKey)}</span>
    </Link>
  );
}

function NavGroups({ active, onNavigate }: { active: ShellSection | null; onNavigate?: () => void }) {
  const t = useT(common);
  const [closed, setClosed] = React.useState<Record<string, boolean>>({});
  return (
    <>
      {NAV.map((group) => {
        const isClosed = closed[group.labelKey] ?? false;
        return (
          <div key={group.labelKey}>
            <button
              type="button"
              onClick={() => setClosed((prev) => ({ ...prev, [group.labelKey]: !isClosed }))}
              aria-expanded={!isClosed}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 pb-1.5 pt-2 text-[13px] font-semibold text-rzp-muted transition-colors hover:text-rzp-text",
                FOCUS_RING,
              )}
            >
              {t(group.labelKey)}
              <ChevronIcon className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isClosed && "-rotate-90")} />
            </button>
            {!isClosed ? (
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <NavLink item={item} active={active === item.key} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function WorkspaceHeader({ merchant, onNavigate }: { merchant: string | null; onNavigate?: () => void }) {
  const t = useT(common);
  const tn = useT(nav);
  const reduce = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const name = merchant ?? DEFAULT_MERCHANT;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative border-b border-rzp-border p-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-rzp-mist", FOCUS_RING)}
      >
        <BrandLogo variant="mark" size={36} href={null} label={name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-bold leading-tight text-rzp-text">{name}</span>
          <span className="block truncate text-xs text-rzp-muted">{t("shell.testWorkspace")}</span>
        </span>
        <ChevronIcon className={cn("h-4 w-4 shrink-0 text-rzp-muted transition-transform", open && "rotate-180")} />
        <span className="sr-only">{t("shell.switchWorkspace")}</span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={id}
            role="group"
            aria-label={t("shell.switchWorkspace")}
            initial={{ opacity: 0, y: reduce ? 0 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
            className="absolute inset-x-2.5 top-full z-30 mt-1 rounded-xl border border-rzp-border bg-white p-2 shadow-lift"
          >
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rzp-muted">{tn("workspace.current")}</p>
            <div className="flex items-center gap-2 rounded-lg bg-rzp-ice px-2 py-1.5">
              <Avatar name={name} className="h-7 w-7 text-[10px] ring-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-rzp-text">{name}</span>
                <span className="block text-xs text-rzp-muted">{t("shell.testWorkspace")}</span>
              </span>
              <CheckIcon className="h-4 w-4 shrink-0 text-rzp-blue" />
            </div>
            <Link
              href="/onboard"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className={cn("mt-1 block rounded-lg px-2 py-1.5 transition-colors hover:bg-rzp-mist", FOCUS_RING)}
            >
              <span className="block text-sm font-medium text-rzp-blueDeep">{tn("workspace.addShop")} →</span>
              <span className="block text-xs text-rzp-muted">{tn("workspace.addShop.desc")}</span>
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function RailsCard({ stats, offline }: ShellStats) {
  const t = useT(common);
  const tn = useT(nav);
  const payments = stats?.modes.payments ?? null;
  const intact = stats?.stats.ledger_intact ?? null;
  const count = stats?.stats.ledger_count ?? null;
  const meter = stats?.eval ? Math.round(stats.eval.explained_pct) : intact === null ? null : intact ? 100 : 0;

  return (
    <div className="rounded-2xl bg-rzp-mist/80 p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-rzp-green animate-dot-pulse" />
        <p className="truncate text-xs font-semibold text-rzp-text">{payments === "mock" ? tn("rails.mock") : t("shell.testRails")}</p>
      </div>

      <div className="mt-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-rzp-muted">
          <span>{tn("rails.meter")}</span>
          <span className="font-mono font-semibold text-rzp-text tnum">{meter === null ? "—" : `${meter}%`}</span>
        </div>
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-rzp-border"
          role="progressbar"
          aria-label={tn("rails.meter")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meter ?? undefined}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-500 ease-out", meter !== null && meter < 100 ? "bg-rzp-amber" : "bg-gradient-to-r from-rzp-blue to-rzp-cyan")}
            style={{ width: `${meter ?? 0}%` }}
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] text-rzp-muted">
        {count === null ? (
          offline ? (
            t("shell.shopOffline")
          ) : (
            tn("rails.waiting")
          )
        ) : (
          <>
            {tn("rails.ledger")} <span className="font-mono font-semibold text-rzp-text tnum">{count}</span>
            {" · "}
            <span className={intact ? "font-medium text-[#087443]" : "font-medium text-[#B3262C]"}>{intact ? tn("rails.chainOk") : tn("rails.chainBroken")}</span>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <AgentVoiceToggle />
        <LanguageToggle size="compact" />
      </div>
    </div>
  );
}

function AvatarRow({ merchant }: { merchant: string | null }) {
  const t = useT(common);
  const name = merchant ?? DEFAULT_MERCHANT;
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl px-2 py-2">
      <Avatar name={name} className="ring-rzp-border" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-rzp-text">{name}</p>
        <p className="truncate text-xs text-rzp-muted">
          {initialsOf(name)} · {t("shell.testWorkspace")}
        </p>
      </div>
    </div>
  );
}

function Sidebar({ active, stats, offline }: { active: ShellSection | null } & ShellStats) {
  const t = useT(common);
  const merchant = stats?.merchant?.name ?? null;
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[264px] shrink-0 flex-col border-r border-rzp-border bg-white lg:flex">
      <WorkspaceHeader merchant={merchant} />
      <nav aria-label={t("shell.primaryNav")} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <NavGroups active={active} />
      </nav>
      <div className="border-t border-rzp-border px-3 pb-3 pt-3">
        <RailsCard stats={stats} offline={offline} />
        <AvatarRow merchant={merchant} />
      </div>
    </aside>
  );
}

function MobileDrawer({ id, open, onClose, active, stats, offline }: { id: string; open: boolean; onClose: () => void; active: ShellSection | null } & ShellStats) {
  const t = useT(common);
  const tn = useT(nav);
  const reduce = useReducedMotion();
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const merchant = stats?.merchant?.name ?? null;

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            aria-hidden="true"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="fixed inset-0 z-40 bg-rzp-navy/45 lg:hidden"
          />
          <motion.aside
            key="panel"
            id={id}
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.primaryNav")}
            initial={{ x: reduce ? 0 : -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduce ? 0 : -24, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] flex-col bg-white shadow-lift lg:hidden"
          >
            <div className="flex h-14 items-center justify-between border-b border-rzp-border px-3">
              <BrandLogo size={30} />
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label={tn("drawer.close")}
                className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg text-rzp-muted hover:bg-rzp-mist hover:text-rzp-text", FOCUS_RING)}
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <WorkspaceHeader merchant={merchant} onNavigate={onClose} />
            <nav aria-label={t("shell.primaryNav")} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-3 py-3">
              <NavGroups active={active} onNavigate={onClose} />
            </nav>
            <div className="border-t border-rzp-border px-3 pb-3 pt-3">
              <RailsCard stats={stats} offline={offline} />
              <AvatarRow merchant={merchant} />
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
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
 * Product chrome: clean white top bar (live TEST MODE pill · mode pills ·
 * avatar), a white sidebar with the gate-mark workspace header, collapsible
 * grouped navigation and the rails card (voice + language), a page header and
 * a mist content area. Under lg the sidebar becomes a drawer behind the menu
 * button. Children render inside a <main>, so pages should not add their own.
 */
export function AppShell({ title, subtitle, actions, headerExtra, children, section, voice, width = "default", contentClassName }: AppShellProps) {
  const pathname = usePathname();
  const active = section ?? sectionForPath(pathname);
  const { stats, offline } = useStatsPoll(10_000);
  const merchantName = stats?.merchant?.name ?? null;
  const payments = stats?.modes.payments ?? null;
  const widthClass = WIDTH[width];
  const tn = useT(nav);
  const drawerId = React.useId();
  const [drawer, setDrawer] = React.useState(false);
  const closeDrawer = React.useCallback(() => setDrawer(false), []);

  React.useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-rzp-mist text-rzp-text">
      <header className="sticky top-0 z-40 h-14 border-b border-rzp-border bg-white">
        <div className="relative flex h-full items-center justify-between gap-3 px-3 sm:px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawer((o) => !o)}
              aria-expanded={drawer}
              aria-controls={drawerId}
              aria-label={drawer ? tn("drawer.close") : tn("drawer.open")}
              className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg text-rzp-muted hover:bg-rzp-mist hover:text-rzp-text lg:hidden", FOCUS_RING)}
            >
              {drawer ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            </button>
            <BrandLogo size={30} className="lg:hidden" />
          </div>

          <div className="absolute left-1/2 hidden -translate-x-1/2 sm:block">
            <TestModePill tone="light" payments={payments} />
          </div>

          <div className="flex items-center gap-2">
            <TestModePill tone="light" payments={payments} className="sm:hidden" />
            <ModeBadges voice={voice} modes={stats?.modes ?? null} offline={offline} className="hidden md:flex" />
            <Avatar name={merchantName} />
          </div>
        </div>
      </header>

      <MobileDrawer id={drawerId} open={drawer} onClose={closeDrawer} active={active} stats={stats} offline={offline} />

      <div className="flex flex-1">
        <Sidebar active={active} stats={stats} offline={offline} />

        <div className="min-w-0 flex-1">
          <div className={cn("mx-auto w-full px-4 pb-4 pt-8 sm:px-6 sm:pt-10 lg:px-8", widthClass)}>
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
