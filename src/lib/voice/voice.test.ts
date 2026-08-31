import { describe, expect, it } from "vitest";
import { toSpeakable } from "./tts";
import { splitSentences } from "./useAgentVoice";

describe("toSpeakable", () => {
  it("never reads URLs aloud", () => {
    const out = toSpeakable("Your payment link is ready: http://localhost:3000/dev/mock-pay?order=ord_abc123. Pay when you like.", "en-IN");
    expect(out).not.toMatch(/http|localhost|ord_/);
    expect(out).toContain("Your payment link is ready");
  });

  it("drops order ids, mandate ids and hex hashes", () => {
    const out = toSpeakable("Order ord_9f3k2 under mandate mnd_77xy is written with hash 3f7a9c1d2e4b5a6f8899aabbccddeeff.", "en-IN");
    expect(out).not.toMatch(/ord_|mnd_|3f7a9c1d/);
  });

  it("still speaks rupees naturally in both languages", () => {
    expect(toSpeakable("Total ₹1,849 only.", "en-IN")).toContain("1,849 rupees");
    expect(toSpeakable("कुल ₹1,849।", "hi-IN")).toContain("1,849 rupaye");
  });

  it("strips bare domains and rzp links", () => {
    const out = toSpeakable("Visit www.example.com or rzp.io/i/abc now.", "en-IN");
    expect(out).not.toMatch(/www\.|rzp\.io/);
  });
});

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
