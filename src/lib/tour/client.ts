"use client";

import { useEffect } from "react";
import { TOUR_STEPS, TOUR_STORAGE_KEY, type TourAction, type TourStep } from "./steps";

/**
 * Browser-side tour bus. The overlay announces the active step; pages react to
 * the step's action (auto-fill the catalog, run the demo buyer, approve the
 * gated order…). Pages never drive the tour themselves.
 */

const EVENT = "agentgate:tour";

export interface TourEventDetail {
  action: TourAction;
  step: TourStep;
}

export function dispatchTourAction(step: TourStep): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TourEventDetail>(EVENT, { detail: { action: step.action, step } }));
}

export function useTourAction(handler: (detail: TourEventDetail) => void): void {
  useEffect(() => {
    const listener = (e: Event) => handler((e as CustomEvent<TourEventDetail>).detail);
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, [handler]);
}

export function isTourActive(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("tour") === "1";
}

export function readTourStep(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(TOUR_STORAGE_KEY);
    const n = raw === null ? 0 : Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= TOUR_STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

export function writeTourStep(index: number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOUR_STORAGE_KEY, String(index));
  } catch {
    /* storage unavailable: the tour still runs from memory */
  }
}

export function clearTourStep(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Route for a step, carrying the tour flag so every page mounts the overlay. */
export function tourHref(step: TourStep): string {
  return `${step.route}?tour=1`;
}
