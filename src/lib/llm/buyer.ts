import { formatINR } from "../money";
import type { ChatMessage, Lang, VerdictEvent } from "../schemas";
import { chatText, llmMode } from "./router";
import { cleanReply, languageRule } from "./seller";

/**
 * The buyer simulator. A scripted buyer drives the three demo goals offline;
 * with an OpenAI key the same turns come from gpt-4o-mini under the verbatim prompt.
 * Either way the buyer only talks — the mandate and the engine bound what it can do.
 */

export const BUYER_SYSTEM_PROMPT = (input: { user_ref: string; goal: string; cap_paise: number; scope: string[] }) =>
  `You are a shopping agent acting under a signed mandate for ${input.user_ref}. Goal: ${input.goal}. Hard cap: ₹${Math.floor(input.cap_paise / 100)}. Scope: ${input.scope.join(", ")}.
Discover products, negotiate briefly, and accept the best offer within cap. Decide within 6 turns; do not haggle endlessly. Never attempt to exceed your mandate. If refused, accept counters that satisfy the goal. Speak in short plain English.`;

export interface DemoGoal {
  key: "gift" | "wedding" | "failure";
  label: string;
  goal: string;
  cap_paise: number;
  scope: string[];
  /** scripted opening lines, in order; later turns react to verdicts */
  script: string[];
}

export const DEMO_GOALS: readonly DemoGoal[] = [
  {
    key: "gift",
    label: "Anniversary gift for mom · ₹2,000",
    goal: "anniversary gift for mom, budget ₹2000",
    cap_paise: 200_000,
    scope: ["handloom", "gifts"],
    script: ["Hi! I'm looking for an anniversary gift for my mom, budget ₹2000. Something handloom would be lovely."],
  },
  {
    key: "wedding",
    label: "Wedding shopping · ₹8,000",
    goal: "2 Banarasi sarees for a wedding, plus juttis if you have them",
    cap_paise: 800_000,
    scope: ["handloom", "gifts"],
    script: ["Do you have golden juttis for a wedding?", "Okay then, I'd like 2 Banarasi sarees for the wedding."],
  },
  {
    key: "failure",
    label: "Happy path, then a bank failure · ₹2,000",
    goal: "anniversary gift for mom, budget ₹2000",
    cap_paise: 200_000,
    scope: ["handloom", "gifts"],
    script: ["Hi! I need an anniversary gift for my mom, budget ₹2000."],
  },
] as const;

export const MAX_BUYER_TURNS = 6;

export interface BuyerState {
  goal: DemoGoal;
  transcript: ChatMessage[];
  last_events: VerdictEvent[];
  /** number of buyer messages already sent */
  turn: number;
  order_placed: boolean;
}

export interface BuyerDecision {
  message: string | null;
  done: boolean;
  reason: string;
}

/** Deterministic buyer: opens with the script, then reacts to the newest verdict. */
export function scriptedBuyerNext(state: BuyerState): BuyerDecision {
  if (state.order_placed) return { message: null, done: true, reason: "order placed" };
  if (state.turn >= MAX_BUYER_TURNS) return { message: null, done: true, reason: "turn limit" };

  const scripted = state.goal.script[state.turn];
  const last = state.last_events.at(-1);

  if (state.turn === 0 && scripted) return { message: scripted, done: false, reason: "opening" };

  if (last) {
    const d = last.verdict.decision;
    if (last.action === "checkout") {
      return { message: null, done: true, reason: d === "ALLOW" || d === "GATE" ? "checked out" : "checkout refused" };
    }
    if (d === "ALLOW") return { message: "Yes, that works — I'll take it.", done: false, reason: "accept offer" };
    if (d === "GATE") return { message: "That's fine, please go ahead and I'll wait for the owner's confirmation.", done: false, reason: "accept gated offer" };
    if (d === "COUNTER") {
      return {
        message: `Okay, I'll go with your counter offer${last.verdict.counter ? ` within ${formatINR(last.verdict.counter.max_total_paise)}` : ""}.`,
        done: false,
        reason: "accept counter",
      };
    }
    if (d === "DENY") {
      if (scripted) return { message: scripted, done: false, reason: "next scripted line" };
      return { message: "Understood. What would you suggest instead within my budget?", done: false, reason: "ask alternative" };
    }
  }

  if (scripted) return { message: scripted, done: false, reason: "next scripted line" };
  return { message: "Could you suggest something that fits my budget?", done: false, reason: "nudge" };
}

/**
 * LLM buyer under the verbatim prompt; falls back to the script when the model
 * is unavailable. `lang` sets the model reply's language (Hindi in Devanagari);
 * the scripted lines are English in both modes.
 */
export async function buyerNext(state: BuyerState, user_ref = "priya@example.com", lang: Lang = "en"): Promise<BuyerDecision & { mode: "openai" | "fallback" }> {
  const scripted = scriptedBuyerNext(state);
  if (scripted.done || llmMode() !== "openai") return { ...scripted, mode: "fallback" };

  const system = BUYER_SYSTEM_PROMPT({ user_ref, goal: state.goal.goal, cap_paise: state.goal.cap_paise, scope: state.goal.scope });
  const messages = state.transcript
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "buyer" ? ("assistant" as const) : ("user" as const), content: m.content }));
  const last = state.last_events.at(-1);
  if (last) {
    messages.push({
      role: "user",
      content: `[policy verdict on the last offer: ${last.verdict.decision} — ${last.verdict.human_reason}${last.verdict.counter ? ` Counter: ${formatINR(last.verdict.counter.max_total_paise)}` : ""}]`,
    });
  }
  if (messages.length === 0) messages.push({ role: "user", content: "The seller is ready. Say what you are looking for." });

  const text = await chatText({ model: "light", system: `${system}\nPlain text only — no markdown, no lists.\n${languageRule(lang)}`, messages, temperature: 0, max_tokens: 120 });
  const cleaned = text ? cleanReply(text) : "";
  if (!cleaned) return { ...scripted, mode: "fallback" };
  return { message: cleaned, done: false, reason: "model", mode: "openai" };
}
