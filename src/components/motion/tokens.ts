/**
 * Shared motion-kit tokens: the brief's marketing palette (primary blue tuned
 * away from Razorpay's hue, the logo's teal, a sparing saffron) plus the one
 * easing curve every reveal in the kit uses.
 */

export type MotionAccent = "blue" | "teal" | "saffron";

export interface AccentTokens {
  /** eyebrow / label colour — dark enough for 4.5:1 on white */
  text: string;
  /** dot, indicator, active-state colour */
  dot: string;
  /** soft surface tint behind a visual */
  tint: string;
  /** translucent glow for radial highlights */
  glow: string;
}

export const ACCENTS: Record<MotionAccent, AccentTokens> = {
  blue: { text: "#1B45B8", dot: "#2F6BFF", tint: "#F3F7FF", glow: "rgba(47, 107, 255, 0.28)" },
  teal: { text: "#0E7C96", dot: "#17A9CC", tint: "#EAF8FB", glow: "rgba(46, 196, 230, 0.32)" },
  saffron: { text: "#B4530A", dot: "#FF7A1A", tint: "#FFF3EA", glow: "rgba(255, 122, 26, 0.28)" },
};

export const NAVY = "#0B1D3A";
export const TEXT = "#14213D";
export const MUTED = "#5B6B8C";
export const BORDER = "#E3EAF5";
export const TEAL = "#17A9CC";
export const CYAN = "#2EC4E6";

/** The kit's ease-out — matches the `fade-up` curve already in globals.css. */
export const EASE_OUT: [number, number, number, number] = [0.2, 0.7, 0.2, 1];

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
