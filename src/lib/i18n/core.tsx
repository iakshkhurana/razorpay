"use client";

import * as React from "react";

/**
 * The bilingual layer: one locale for the whole site (English / Hindi in
 * Devanagari), per-screen dictionaries, and the voice tag that follows it.
 *
 * The locale lives in a tiny module store so every consumer — the toggle in
 * the top bar, the shell, a chat pane — sees one value and one setLocale.
 * Nothing here runs during the first render: storage is read in an effect,
 * so the server and the first client paint both say "en" and hydration stays
 * clean; a stored Hindi choice switches the page one frame later.
 */

export type Locale = "en" | "hi";

export const LOCALES: readonly Locale[] = ["en", "hi"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "agentgate.locale";

/** BCP-47 tag for the Web Speech API and Sarvam's target_language_code. */
export type VoiceLang = "en-IN" | "hi-IN";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "hi";
}

/** "hi" → "hi-IN", everything else → "en-IN". */
export function voiceLangFor(locale: Locale | null | undefined): VoiceLang {
  return locale === "hi" ? "hi-IN" : "en-IN";
}

/** The locale a piece of text is written in (Devanagari → "hi"). */
export function localeOfText(text: string): Locale {
  return /[ऀ-ॿ]/.test(text) ? "hi" : "en";
}

/** Native-script name of a locale, for menus and screen readers. */
export function localeName(locale: Locale): string {
  return locale === "hi" ? "हिन्दी" : "English";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "hi" ? "en" : "hi";
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

let locale: Locale = DEFAULT_LOCALE;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getLocale = () => locale;
const getServerLocale = () => DEFAULT_LOCALE;
const getHydrated = () => hydrated;
const getServerHydrated = () => false;

function readStored(): Locale | null {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeStored(next: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    /* storage unavailable: the choice lives in memory for this page */
  }
}

function applyLocale(next: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (locale === next) return;
  locale = next;
  emit();
}

/** Reads the stored choice once, then follows changes made in other tabs. */
function hydrate(initial?: Locale): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  applyLocale(readStored() ?? initial ?? DEFAULT_LOCALE);
  window.addEventListener("storage", (e) => {
    if (e.key === LOCALE_STORAGE_KEY && isLocale(e.newValue)) applyLocale(e.newValue);
  });
  emit();
}

/** Switches the whole site. Safe to call from anywhere on the client. */
export function setLocale(next: Locale): void {
  if (!isLocale(next)) return;
  writeStored(next);
  applyLocale(next);
}

/* ------------------------------------------------------------------ */
/*  Provider + hooks                                                   */
/* ------------------------------------------------------------------ */

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  /** false until the stored choice has been read (first client effect) */
  ready: boolean;
}

export const LocaleContext = React.createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale,
  ready: false,
});

/**
 * Current locale + setter. Works with or without a LocaleProvider above it
 * (the store hydrates itself on first use), so a toggle dropped into any
 * client tree just works.
 */
export function useLocale(): LocaleContextValue {
  const current = React.useSyncExternalStore(subscribe, getLocale, getServerLocale);
  const ready = React.useSyncExternalStore(subscribe, getHydrated, getServerHydrated);
  React.useEffect(() => {
    hydrate();
  }, []);
  return React.useMemo(() => ({ locale: current, setLocale, ready }), [current, ready]);
}

export interface LocaleProviderProps {
  children: React.ReactNode;
  /** used only when nothing is stored yet (default "en") */
  initial?: Locale;
}

/**
 * Mounts the locale store for the app: reads localStorage in an effect,
 * mirrors the choice onto <html lang>, and exposes { locale, setLocale }.
 * Renders children immediately (in "en"), so nothing shifts while it loads.
 */
export function LocaleProvider({ children, initial }: LocaleProviderProps) {
  React.useEffect(() => {
    hydrate(initial);
  }, [initial]);
  const value = useLocale();
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Dictionaries                                                       */
/* ------------------------------------------------------------------ */

/**
 * A per-screen dictionary: English is complete, Hindi may lag and falls back
 * to English key by key. Values interpolate `{{var}}` placeholders.
 */
export interface Dict<K extends string = string> {
  en: Record<K, string>;
  hi: Partial<Record<K, string>>;
}

export type Vars = Record<string, string | number>;

export type Translator<K extends string> = (key: K, vars?: Vars) => string;

/** Identity helper that infers the key set so `t("typo")` is a compile error and every key has English. */
export function dict<K extends string>(d: Dict<K>): Dict<K> {
  return d;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** Fills `{{var}}` slots; unknown slots stay as written so a missing value is visible, not silent. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Plain lookup for code that runs outside React (toasts, speech, tour captions). */
export function translate<K extends string>(d: Dict<K>, loc: Locale, key: K, vars?: Vars): string {
  const hi = loc === "hi" ? d.hi[key] : undefined;
  const template = hi ?? d.en[key] ?? key;
  return interpolate(template, vars);
}

/**
 * `const t = useT(strings)` → `t("key", { var })`. Re-renders with the locale;
 * missing Hindi keys read the English line so a half-translated screen never
 * shows raw keys.
 */
export function useT<K extends string>(d: Dict<K>): Translator<K> {
  const { locale: current } = useLocale();
  return React.useCallback((key: K, vars?: Vars) => translate(d, current, key, vars), [d, current]);
}

/** Picks the value for the current locale from an inline pair — for one-off strings that do not belong in a dictionary. */
export function useLocalized(): <T>(en: T, hi: T) => T {
  const { locale: current } = useLocale();
  return React.useCallback(<T,>(en: T, hi: T): T => (current === "hi" ? hi : en), [current]);
}
