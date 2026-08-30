/**
 * The Grand Tour: ten captioned steps that drive the product end to end.
 * Each step names the route it plays on and an `action` the page dispatches
 * when the step becomes active. Captions are the merchant-facing script.
 */

export type TourAction =
  | "landing:hero"
  | "onboard:autofill"
  | "onboard:review"
  | "simulator:mandate"
  | "simulator:bundle"
  | "simulator:pay"
  | "simulator:overspend"
  | "dashboard:gate"
  | "dashboard:failure"
  | "eval:show";

export interface TourStep {
  /** 1-based, shown on the caption card */
  n: number;
  route: "/" | "/onboard" | "/simulator" | "/dashboard" | "/eval";
  action: TourAction;
  caption: string;
  /** how long the step holds before auto-advancing */
  hold_ms: number;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { n: 1, route: "/", action: "landing:hero", caption: "This is AgentGate. Watch the book write itself.", hold_ms: 6000 },
  { n: 2, route: "/onboard", action: "onboard:autofill", caption: "Ramesh ji pastes his messy catalog.", hold_ms: 6000 },
  { n: 3, route: "/onboard", action: "onboard:review", caption: "AI drafted the rulebook. Ramesh ji approves it — humans set the rules.", hold_ms: 7000 },
  { n: 4, route: "/simulator", action: "simulator:mandate", caption: "An AI buyer arrives with a ₹2,000 mandate.", hold_ms: 6000 },
  { n: 5, route: "/simulator", action: "simulator:bundle", caption: "The seller agent upsells a blouse — ₹1,849, inside every rule.", hold_ms: 9000 },
  { n: 6, route: "/simulator", action: "simulator:pay", caption: "Money moved. The book already explains why.", hold_ms: 8000 },
  { n: 7, route: "/simulator", action: "simulator:overspend", caption: "₹5,000 try on a ₹2,000 mandate — COUNTER, not crash.", hold_ms: 8000 },
  { n: 8, route: "/dashboard", action: "dashboard:gate", caption: "Big order? The owner decides. AI never does.", hold_ms: 10000 },
  { n: 9, route: "/dashboard", action: "dashboard:failure", caption: "Bank failed the payment. Order HELD, backup link issued — gracefully.", hold_ms: 10000 },
  { n: 10, route: "/eval", action: "eval:show", caption: "Not vibes — measured. 0 breaches across 40 attacks.", hold_ms: 8000 },
] as const;

export const TOUR_END_CARD = "Har paisa, likha hua.";

export const TOUR_STORAGE_KEY = "agentgate.tour.step";

export function stepAt(index: number): TourStep | null {
  return TOUR_STEPS[index] ?? null;
}
