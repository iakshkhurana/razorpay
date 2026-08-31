import { describe, expect, it } from "vitest";
import { splitSentences } from "./useAgentVoice";

describe("splitSentences", () => {
  it("splits English sentences and keeps punctuation", () => {
    expect(splitSentences("Namaste ji. The saree is ₹1,499! Shall we proceed?")).toEqual([
      "Namaste ji. The saree is ₹1,499!",
      "Shall we proceed?",
    ]);
  });

  it("splits on the Devanagari danda", () => {
    expect(splitSentences("आज AI ने ₹1,849 की बिक्री की। खाता पूरी तरह सही है।")).toEqual([
      "आज AI ने ₹1,849 की बिक्री की।",
      "खाता पूरी तरह सही है।",
    ]);
  });

  it("merges tiny fragments so a two-word chunk never costs a TTS round-trip", () => {
    const parts = splitSentences("Done. Your payment link is ready; the order is confirmed the moment the bank says yes.");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("Done.");
  });

  it("returns unpunctuated text as one chunk", () => {
    expect(splitSentences("hello there")).toEqual(["hello there"]);
    expect(splitSentences("   ")).toEqual([]);
  });
});
