import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetMetrics,
  beginTurn,
  endTurn,
  estimateCostPaise,
  listMetrics,
  recordLlmCall,
  recordToolCall,
  recordVoiceCall,
  summarizeMetrics,
} from "./metrics";

describe("metrics", () => {
  beforeEach(() => {
    _resetMetrics();
  });

  it("attributes LLM and tool calls to the active turn", () => {
    beginTurn("negotiate", "en");
    recordLlmCall({ model: "gpt-4o", duration_ms: 900, prompt_tokens: 1000, completion_tokens: 100 });
    recordToolCall("get_offer", 40);
    endTurn({ mode: "openai" });

    const [turn] = listMetrics();
    expect(turn.route).toBe("negotiate");
    expect(turn.llm_calls).toHaveLength(1);
    expect(turn.tools).toEqual([{ name: "get_offer", duration_ms: 40 }]);
    expect(turn.mode).toBe("openai");
    expect(turn.ok).toBe(true);
  });

  it("logs an LLM call outside a turn standalone and voice calls one-shot", () => {
    recordLlmCall({ model: "gpt-4o-mini", duration_ms: 300, prompt_tokens: 50, completion_tokens: 20 });
    recordVoiceCall("tts", 450, true, 80);
    const routes = listMetrics().map((m) => m.route);
    expect(routes).toContain("llm");
    expect(routes).toContain("tts");
  });

  it("estimates cost from list prices per model", () => {
    const paise = estimateCostPaise([
      { model: "gpt-4o", duration_ms: 0, prompt_tokens: 1_000_000, completion_tokens: 0 },
      { model: "gpt-4o", duration_ms: 0, prompt_tokens: 0, completion_tokens: 1_000_000 },
    ]);
    // (2.5 + 10) USD × ₹88 = ₹1,100 = 110000 paise
    expect(paise).toBe(110_000);
    expect(estimateCostPaise([{ model: "unknown", duration_ms: 0, prompt_tokens: 1000, completion_tokens: 1000 }])).toBe(0);
  });

  it("summarizes turns and token totals", () => {
    beginTurn("negotiate");
    recordLlmCall({ model: "gpt-4o", duration_ms: 800, prompt_tokens: 500, completion_tokens: 60 });
    endTurn({});
    recordVoiceCall("tts", 400, true, 60);
    const s = summarizeMetrics();
    expect(s.turns).toBe(1);
    expect(s.avg_first_llm_ms).toBe(800);
    expect(s.avg_tts_ms).toBe(400);
    expect(s.total_prompt_tokens).toBe(500);
    expect(s.total_completion_tokens).toBe(60);
    expect(s.est_cost_paise).toBeGreaterThan(0);
  });
});
