"use client";

import * as React from "react";
import { LOCALES, useLocale, useT, type Locale } from "@/lib/i18n/core";
import { common } from "@/lib/i18n/strings/common";
import { cn } from "@/lib/utils";

/**
 * Segmented pill that switches the site between English and Hindi.
 * Two real buttons with aria-pressed, arrow keys move between them, and the
 * sliding thumb is pure CSS so reduced-motion users get an instant switch.
 */

export interface LanguageToggleProps {
  className?: string;
  /** "compact" fits the 28px top-bar row; "default" matches 32px controls */
  size?: "default" | "compact";
  /** "dark" sits on the navy bars; "light" on white or mist surfaces */
  tone?: "light" | "dark";
}

const SHORT: Record<Locale, string> = { en: "EN", hi: "हिं" };

export function LanguageToggle({ className, size = "default", tone = "light" }: LanguageToggleProps) {
  const { locale, setLocale } = useLocale();
  const t = useT(common);
  const groupRef = React.useRef<HTMLDivElement>(null);
  const compact = size === "compact";
  const index = Math.max(0, LOCALES.indexOf(locale));

  const fullName = (value: Locale) => (value === "hi" ? t("lang.hindi") : t("lang.english"));

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % LOCALES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + LOCALES.length) % LOCALES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = LOCALES.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = LOCALES[next];
    setLocale(target);
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[next]?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={t("lang.label")}
      className={cn(
        "relative inline-grid shrink-0 select-none grid-cols-2 rounded-full border p-0.5",
        compact ? "h-7" : "h-8",
        tone === "dark" ? "border-white/15 bg-white/10" : "border-rzp-border bg-white shadow-sm",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full transition-transform duration-200 ease-out motion-reduce:transition-none",
          tone === "dark" ? "bg-white" : "bg-rzp-navy",
        )}
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {LOCALES.map((value, i) => {
        const active = value === locale;
        return (
          <button
            key={value}
            type="button"
            lang={value}
            aria-pressed={active}
            aria-label={fullName(value)}
            title={active ? fullName(value) : value === "hi" ? t("lang.switchToHindi") : t("lang.switchToEnglish")}
            onClick={() => setLocale(value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center rounded-full font-semibold leading-none transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
              compact ? "w-8 text-[11px]" : "w-10 text-xs",
              tone === "dark"
                ? cn("focus-visible:ring-offset-rzp-navy", active ? "text-rzp-navy" : "text-white/80 hover:text-white")
                : cn("focus-visible:ring-offset-white", active ? "text-white" : "text-rzp-muted hover:text-rzp-text"),
            )}
          >
            {SHORT[value]}
          </button>
        );
      })}
    </div>
  );
}
