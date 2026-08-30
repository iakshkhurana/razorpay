"use client";

import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { NotchTab, TestModePill, useStatsPoll } from "@/components/AppShell";
import { BrandLogo } from "@/components/BrandLogo";
import { ChatVerdict, LedgerStamp, ShieldCheck, Storefront, type IllustrationProps } from "@/components/illustrations";
import { LanguageToggle } from "@/components/LanguageToggle";
import { buttonClasses } from "@/components/ui/button";
import { useT } from "@/lib/i18n/core";
import { common } from "@/lib/i18n/strings/common";
import { nav, type NavKey } from "@/lib/i18n/strings/nav";
import { clearTourStep } from "@/lib/tour/client";
import { cn } from "@/lib/utils";

/**
 * Marketing navigation: a white bar with the brand chip on the left, the menu,
 * a downward notch tab in the centre holding the live "● TEST MODE · Razorpay"
 * pill, and the language toggle + "Open Control Tower" on the right. Product
 * and Solutions open full-width panels (hover / focus / click); under lg the
 * menu lives in a full-height drawer. Sticky with a frosted white ground once
 * the page scrolls.
 */

type CommonKey = keyof typeof common.en;
type PanelKey = "product" | "solutions";

type MenuEntry = { key: PanelKey; labelKey: CommonKey; kind: "panel" } | { key: "developers" | "pricing" | "evidence"; labelKey: CommonKey; kind: "link"; href: string };

const MENU: readonly MenuEntry[] = [
  { key: "product", labelKey: "nav.product", kind: "panel" },
  { key: "solutions", labelKey: "nav.solutions", kind: "panel" },
  { key: "developers", labelKey: "nav.developers", kind: "link", href: "/developers" },
  { key: "pricing", labelKey: "nav.pricing", kind: "link", href: "/pricing" },
  { key: "evidence", labelKey: "nav.evidence", kind: "link", href: "/eval" },
];

interface ProductItem {
  href: string;
  labelKey: CommonKey;
  descKey: NavKey;
  Art: (props: IllustrationProps) => React.ReactElement;
}

const PRODUCT_ITEMS: readonly ProductItem[] = [
  { href: "/onboard", labelKey: "app.onboard", descKey: "product.onboard.desc", Art: Storefront },
  { href: "/simulator", labelKey: "app.simulator", descKey: "product.simulator.desc", Art: ChatVerdict },
  { href: "/dashboard", labelKey: "app.tower", descKey: "product.tower.desc", Art: LedgerStamp },
  { href: "/eval", labelKey: "app.evidence", descKey: "product.evidence.desc", Art: ShieldCheck },
];

interface SolutionItem {
  /** landing-page anchors: the sections carry these ids */
  href: string;
  labelKey: NavKey;
  descKey: NavKey;
  image: string;
  accent: "teal" | "saffron";
}

const SOLUTION_ITEMS: readonly SolutionItem[] = [
  { href: "/#retail", labelKey: "solutions.kirana", descKey: "solutions.kirana.desc", image: "/images/industry-retail.jpg", accent: "teal" },
  { href: "/#fuel", labelKey: "solutions.fuel", descKey: "solutions.fuel.desc", image: "/images/industry-fuel.jpg", accent: "saffron" },
];

const OPEN_DELAY_MS = 60;
const CLOSE_DELAY_MS = 140;

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white";

const MENU_ITEM =
  "inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13.5px] font-medium text-rzp-text/85 transition-colors hover:bg-rzp-ice hover:text-rzp-navy " + FOCUS_RING;

function panelVariants(reduce: boolean): Variants {
  return {
    hidden: { opacity: 0, y: reduce ? 0 : 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduce ? 0 : 0.22, ease: "easeOut", when: "beforeChildren", staggerChildren: reduce ? 0 : 0.045 },
    },
    exit: { opacity: 0, y: reduce ? 0 : 8, transition: { duration: reduce ? 0 : 0.16, ease: "easeIn" } },
  };
}

function itemVariants(reduce: boolean): Variants {
  return {
    hidden: { opacity: 0, y: reduce ? 0 : 6 },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.22, ease: "easeOut" } },
    exit: { opacity: 0, transition: { duration: reduce ? 0 : 0.1 } },
  };
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ------------------------------------------------------------------ */
/*  Panels                                                             */
/* ------------------------------------------------------------------ */

function ProductPanel({ onNavigate, reduce }: { onNavigate: () => void; reduce: boolean }) {
  const t = useT(common);
  const tn = useT(nav);
  const item = itemVariants(reduce);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div>
        <motion.p variants={item} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rzp-muted">
          {tn("product.eyebrow")}
        </motion.p>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {PRODUCT_ITEMS.map((p) => (
            <motion.li key={p.href} variants={item}>
              <Link href={p.href} onClick={onNavigate} className={cn("group flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-rzp-ice", FOCUS_RING)}>
                <span className="grid h-16 w-[5.5rem] shrink-0 place-items-center overflow-hidden rounded-lg bg-rzp-mist ring-1 ring-rzp-border">
                  <p.Art animate={false} className="h-14 w-auto" />
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="flex items-center gap-1 font-semibold text-rzp-text group-hover:text-rzp-blueDeep">
                    {t(p.labelKey)}
                    <ArrowIcon className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100" />
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-rzp-muted">{tn(p.descKey)}</span>
                </span>
              </Link>
            </motion.li>
          ))}
        </ul>
      </div>

      <motion.div variants={item} className="bg-arcs-light relative overflow-hidden rounded-2xl bg-rzp-navy p-5 text-white">
        <div aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-rzp-teal/30 blur-2xl" />
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">{t("brand.tagline")}</p>
        <p className="relative mt-2 font-display text-xl font-bold leading-tight">{tn("product.rule")}</p>
        <p className="relative mt-2 text-sm leading-relaxed text-white/75">{tn("product.rule.desc")}</p>
        <Link
          href="/?tour=1"
          onClick={() => {
            clearTourStep();
            onNavigate();
          }}
          className={buttonClasses({ variant: "pill-outline", size: "sm", className: "relative mt-5 focus-visible:ring-offset-rzp-navy" })}
        >
          {t("btn.watchTour")}
        </Link>
        <p className="relative mt-2 text-xs text-white/60">{tn("product.tour.desc")}</p>
      </motion.div>
    </div>
  );
}

function SolutionsPanel({ onNavigate, reduce, evalStats }: { onNavigate: () => void; reduce: boolean; evalStats: { breaches: number; attacks: number } | null }) {
  const t = useT(common);
  const tn = useT(nav);
  const item = itemVariants(reduce);
  return (
    <div>
      <motion.p variants={item} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rzp-muted">
        {tn("solutions.eyebrow")}
      </motion.p>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
        {SOLUTION_ITEMS.map((s) => (
          <motion.div key={s.href} variants={item}>
            <Link href={s.href} onClick={onNavigate} className={cn("group block overflow-hidden rounded-2xl border border-rzp-border bg-white transition-shadow hover:shadow-card", FOCUS_RING)}>
              <span className="relative block h-28 overflow-hidden">
                <Image src={s.image} alt="" width={735} height={420} unoptimized className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-rzp-navy/60 to-transparent" />
                <span
                  className={cn(
                    "absolute bottom-2.5 left-2.5 inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold text-white",
                    s.accent === "teal" ? "bg-rzp-teal" : "bg-rzp-saffron",
                  )}
                >
                  {tn(s.labelKey)}
                </span>
              </span>
              <span className="block p-3.5">
                <span className="flex items-center gap-1 font-semibold text-rzp-text group-hover:text-rzp-blueDeep">
                  {tn(s.labelKey)}
                  <ArrowIcon className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
                <span className="mt-1 block text-sm leading-snug text-rzp-muted">{tn(s.descKey)}</span>
              </span>
            </Link>
          </motion.div>
        ))}

        <motion.div variants={item} className="flex flex-col justify-between rounded-2xl bg-rzp-ice p-4 ring-1 ring-rzp-border">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rzp-muted">{t("nav.evidence")}</p>
            <p className="mt-2 font-display text-3xl font-bold tracking-tight text-rzp-navy tnum">
              {evalStats ? `${evalStats.breaches}/${evalStats.attacks}` : "0"}
            </p>
            <p className="mt-1 text-sm text-rzp-muted">{tn("product.evidence.desc")}</p>
          </div>
          <Link href="/eval" onClick={onNavigate} className={cn("mt-4 inline-flex items-center gap-1 text-sm font-semibold text-rzp-blueDeep hover:underline", FOCUS_RING)}>
            {t("btn.seeEvidence")}
            <ArrowIcon className="h-4 w-4" />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop menu item                                                  */
/* ------------------------------------------------------------------ */

interface PanelItemProps {
  entry: Extract<MenuEntry, { kind: "panel" }>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
  children: React.ReactNode;
}

function PanelMenuItem({ entry, open, onOpen, onClose, onToggle, children }: PanelItemProps) {
  const t = useT(common);
  const reduce = useReducedMotion() === true;
  const panelId = React.useId();
  const liRef = React.useRef<HTMLLIElement>(null);

  return (
    <li
      ref={liRef}
      className="static"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onFocus={onOpen}
      onBlur={(e) => {
        if (!liRef.current?.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={onToggle}
        className={cn(MENU_ITEM, open && "bg-rzp-ice text-rzp-navy")}
      >
        {t(entry.labelKey)}
        <ChevronIcon className={cn("h-3.5 w-3.5 text-rzp-muted transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            role="region"
            aria-label={t(entry.labelKey)}
            variants={panelVariants(reduce)}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute inset-x-0 top-full z-20 border-b border-rzp-border bg-white shadow-[0_28px_48px_-28px_rgba(11,29,58,0.35)]"
          >
            <div className="mx-auto max-w-7xl px-4 pb-8 pt-12 sm:px-6">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile drawer                                                      */
/* ------------------------------------------------------------------ */

function MobileDrawer({ id, open, onClose, payments, pathname }: { id: string; open: boolean; onClose: () => void; payments: "mock" | "razorpay" | null; pathname: string | null }) {
  const t = useT(common);
  const tn = useT(nav);
  const reduce = useReducedMotion() === true;
  const item = itemVariants(reduce);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const rowClass = cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-medium text-rzp-text hover:bg-rzp-ice", FOCUS_RING);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.menu")}
          variants={panelVariants(reduce)}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-white lg:hidden"
        >
          <nav aria-label={t("nav.menu")} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6">
            <motion.section variants={item}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-rzp-muted">{t("nav.product")}</p>
              <ul className="space-y-0.5">
                {PRODUCT_ITEMS.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} onClick={onClose} aria-current={isActivePath(pathname, p.href) ? "page" : undefined} className={rowClass}>
                      <span className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-rzp-mist ring-1 ring-rzp-border">
                        <p.Art animate={false} className="h-10 w-auto" />
                      </span>
                      <span className="min-w-0">
                        <span className="block">{t(p.labelKey)}</span>
                        <span className="block text-sm font-normal leading-snug text-rzp-muted">{tn(p.descKey)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.section>

            <motion.section variants={item}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-rzp-muted">{t("nav.solutions")}</p>
              <ul className="space-y-0.5">
                {SOLUTION_ITEMS.map((s) => (
                  <li key={s.href}>
                    <Link href={s.href} onClick={onClose} className={rowClass}>
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.accent === "teal" ? "bg-rzp-teal" : "bg-rzp-saffron")} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block">{tn(s.labelKey)}</span>
                        <span className="block text-sm font-normal leading-snug text-rzp-muted">{tn(s.descKey)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.section>

            <motion.ul variants={item} className="space-y-0.5 border-t border-rzp-border pt-4">
              {MENU.filter((m): m is Extract<MenuEntry, { kind: "link" }> => m.kind === "link").map((m) => (
                <li key={m.key}>
                  <Link href={m.href} onClick={onClose} aria-current={isActivePath(pathname, m.href) ? "page" : undefined} className={rowClass}>
                    {t(m.labelKey)}
                  </Link>
                </li>
              ))}
            </motion.ul>

            <motion.div variants={item} className="flex flex-col gap-3 border-t border-rzp-border pt-4">
              <div className="flex items-center justify-between gap-3 px-1">
                <TestModePill tone="light" payments={payments} />
                <LanguageToggle size="compact" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/dashboard" onClick={onClose} className={buttonClasses({ variant: "pill", size: "md" })}>
                  {t("nav.openTower")}
                </Link>
                <Link href="/onboard" onClick={onClose} className={buttonClasses({ variant: "pill-outline", size: "md" })}>
                  {t("btn.onboardShop")}
                </Link>
              </div>
            </motion.div>
          </nav>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  The nav                                                            */
/* ------------------------------------------------------------------ */

export interface MarketingNavProps {
  className?: string;
}

export function MarketingNav({ className }: MarketingNavProps) {
  const t = useT(common);
  const pathname = usePathname();
  const reduce = useReducedMotion() === true;
  const { stats } = useStatsPoll(15_000);
  const payments = stats?.modes.payments ?? null;
  const evalStats = stats?.eval ? { breaches: stats.eval.breaches, attacks: stats.eval.attacks } : null;

  const [scrolled, setScrolled] = React.useState(false);
  const [openPanel, setOpenPanel] = React.useState<PanelKey | null>(null);
  const [drawer, setDrawer] = React.useState(false);
  const headerRef = React.useRef<HTMLElement>(null);
  const timer = React.useRef<number | null>(null);
  const drawerId = React.useId();

  const clearTimer = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const scheduleOpen = React.useCallback(
    (key: PanelKey) => {
      clearTimer();
      timer.current = window.setTimeout(() => setOpenPanel(key), OPEN_DELAY_MS);
    },
    [clearTimer],
  );

  const scheduleClose = React.useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpenPanel(null), CLOSE_DELAY_MS);
  }, [clearTimer]);

  const closeAll = React.useCallback(() => {
    clearTimer();
    setOpenPanel(null);
  }, [clearTimer]);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeAll();
      setDrawer(false);
    };
    const onDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [closeAll]);

  React.useEffect(() => {
    closeAll();
    setDrawer(false);
  }, [pathname, closeAll]);

  React.useEffect(() => clearTimer, [clearTimer]);

  const frosted = scrolled || openPanel !== null || drawer;
  const closeDrawer = React.useCallback(() => setDrawer(false), []);

  return (
    <header
      ref={headerRef}
      className={cn(
        "sticky top-0 z-40 h-16 border-b transition-[background-color,border-color,box-shadow] duration-200",
        frosted ? "border-rzp-border bg-white/85 shadow-[0_4px_20px_rgba(20,33,61,0.06)] backdrop-blur-md" : "border-transparent bg-white/95",
        className,
      )}
    >
      <div className="relative mx-auto grid h-full max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-6 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* left: brand + menu */}
        <div className="flex items-center gap-2 lg:gap-5">
          <BrandLogo variant="chip" size={36} priority />
          <nav aria-label={t("shell.primaryNav")} className="hidden lg:block">
            <ul className="flex items-center gap-0.5">
              {MENU.map((entry) =>
                entry.kind === "panel" ? (
                  <PanelMenuItem
                    key={entry.key}
                    entry={entry}
                    open={openPanel === entry.key}
                    onOpen={() => scheduleOpen(entry.key)}
                    onClose={scheduleClose}
                    onToggle={() => {
                      clearTimer();
                      setOpenPanel((current) => (current === entry.key ? null : entry.key));
                    }}
                  >
                    {entry.key === "product" ? <ProductPanel onNavigate={closeAll} reduce={reduce} /> : <SolutionsPanel onNavigate={closeAll} reduce={reduce} evalStats={evalStats} />}
                  </PanelMenuItem>
                ) : (
                  <li key={entry.key} onMouseEnter={scheduleClose}>
                    <Link href={entry.href} aria-current={isActivePath(pathname, entry.href) ? "page" : undefined} className={cn(MENU_ITEM, isActivePath(pathname, entry.href) && "text-rzp-blueDeep")}>
                      {t(entry.labelKey)}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
        </div>

        {/* centre: the notch tab with the live pill */}
        <div className="relative hidden h-full lg:block">
          <NotchTab tone="light">
            <TestModePill tone="light" payments={payments} className="border-transparent shadow-none" />
          </NotchTab>
        </div>

        {/* right: language + CTA + menu button */}
        <div className="flex items-center justify-end gap-2">
          <TestModePill tone="light" payments={payments} className="hidden sm:inline-flex lg:hidden" />
          <LanguageToggle size="compact" className="hidden sm:inline-grid" />
          <Link href="/dashboard" className={buttonClasses({ variant: "pill", size: "sm", className: "hidden h-9 md:inline-flex" })}>
            {t("nav.openTower")}
          </Link>
          <button
            type="button"
            onClick={() => setDrawer((o) => !o)}
            aria-expanded={drawer}
            aria-controls={drawerId}
            aria-label={drawer ? t("nav.closeMenu") : t("nav.openMenu")}
            className={cn("inline-flex h-10 w-10 items-center justify-center rounded-lg text-rzp-navy hover:bg-rzp-ice lg:hidden", FOCUS_RING)}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              {drawer ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      <MobileDrawer id={drawerId} open={drawer} onClose={closeDrawer} payments={payments} pathname={pathname} />
    </header>
  );
}
