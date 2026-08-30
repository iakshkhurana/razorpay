"use client";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "./tokens";

export interface IndustryTab {
  id: string;
  /** segmented-control label */
  label: string;
  title: string;
  body: string;
  /** local image path, e.g. "/images/industry-retail.jpg" */
  image: string;
  bullets: string[];
  /** word (or phrase) inside `title` to paint teal; defaults to the last word */
  highlight?: string;
  /** describes the photo for assistive tech; empty = decorative */
  imageAlt?: string;
  cta?: { label: string; href: string };
}

export interface IndustryTabsProps {
  tabs: IndustryTab[];
  /** id of the tab open on first render (defaults to the first tab) */
  defaultTabId?: string;
  /** accessible name of the tab list */
  label?: string;
  className?: string;
}

const DEFAULT_CTA = { label: "Open Control Tower", href: "/dashboard" };

const OVERLAY: CSSProperties = {
  backgroundImage:
    "linear-gradient(100deg, rgba(11,29,58,0.88) 0%, rgba(11,29,58,0.62) 42%, rgba(11,29,58,0.18) 100%)",
};

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#EAF8FB" stroke="#17A9CC" strokeWidth="1.2" />
      <path d="m6.2 10.2 2.5 2.5 5-5.4" stroke="#0E7C96" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Splits the title so one word (or phrase) can be painted teal. */
function splitTitle(title: string, highlight?: string): [string, string, string] {
  const target = highlight && title.includes(highlight) ? highlight : (title.trim().split(/\s+/).pop() ?? "");
  const at = target ? title.lastIndexOf(target) : -1;
  if (at < 0) return [title, "", ""];
  return [title.slice(0, at), target, title.slice(at + target.length)];
}

/**
 * Two (or more) industry scenes: a segmented control with a sliding underline,
 * a full-bleed photo card with a navy wash, and a white glass copy card on the
 * left. Tabs crossfade; arrow keys move between them.
 */
export function IndustryTabs({ tabs, defaultTabId, label = "Industries", className }: IndustryTabsProps) {
  const reduce = useReducedMotion();
  const uid = useId();
  const [activeId, setActiveId] = useState(() => defaultTabId ?? tabs[0]?.id ?? "");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  if (!active) return null;

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = `${uid}-panel`;

  const focusTab = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    if (!next) return;
    setActiveId(next.id);
    tabRefs.current[(index + tabs.length) % tabs.length]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(tabs.length - 1);
        break;
      default:
    }
  };

  const [before, word, after] = splitTitle(active.title, active.highlight);
  const cta = active.cta ?? DEFAULT_CTA;
  const fade = reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT };

  return (
    <div className={cn("w-full", className)}>
      <LayoutGroup id={uid}>
        <div
          role="tablist"
          aria-label={label}
          className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[#E3EAF5] bg-white p-1 shadow-sm scrollbar-thin"
        >
          {tabs.map((tab, i) => {
            const selected = tab.id === activeId;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={tabId(tab.id)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={cn(
                  "relative whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6BFF] focus-visible:ring-offset-2",
                  selected ? "text-[#0B1D3A]" : "text-[#5B6B8C] hover:text-[#14213D]",
                )}
              >
                {tab.label}
                {selected ? (
                  <motion.span
                    layoutId="industry-underline"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }}
                    className="absolute inset-x-3 -bottom-px h-[3px] rounded-full"
                    style={{ backgroundImage: "linear-gradient(90deg, #17A9CC, #2F6BFF)" }}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(active.id)}
        className="relative mt-6 min-h-[520px] overflow-hidden rounded-3xl bg-[#0B1D3A] shadow-lift"
      >
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          return (
            <motion.div
              key={tab.id}
              initial={false}
              animate={{ opacity: on ? 1 : 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT }}
              className="absolute inset-0"
              aria-hidden={!on}
            >
              <Image
                src={tab.image}
                alt={tab.imageAlt ?? ""}
                fill
                sizes="(min-width: 1280px) 1152px, 100vw"
                className="object-cover"
              />
            </motion.div>
          );
        })}
        <div className="absolute inset-0" style={OVERLAY} aria-hidden="true" />

        <div className="relative grid min-h-[520px] items-center p-4 sm:p-8 lg:grid-cols-[minmax(0,500px)_minmax(0,1fr)] lg:p-10">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={fade}
              className="rounded-2xl border border-white/70 bg-white/90 p-6 shadow-card backdrop-blur-md sm:p-8"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1B45B8]">{active.label}</p>
              <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-[#0B1D3A] sm:text-3xl">
                {before}
                {word ? <span className="text-[#0E7C96]">{word}</span> : null}
                {after}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#5B6B8C] sm:text-base">{active.body}</p>
              <ul className="mt-5 space-y-2.5">
                {active.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2.5 text-sm text-[#14213D]">
                    <CheckGlyph />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={cta.href}
                className={buttonClasses({
                  variant: "primary",
                  size: "md",
                  className: "mt-6 border-[#1B45B8] bg-[#1B45B8] hover:border-[#163A9C] hover:bg-[#163A9C] active:bg-[#12308A]",
                })}
              >
                {cta.label}
              </Link>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
