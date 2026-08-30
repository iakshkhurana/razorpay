import { describe, expect, it } from "vitest";
import { dict, interpolate, isLocale, localeOfText, otherLocale, translate, voiceLangFor } from "./core";
import { common } from "./strings/common";
import { nav } from "./strings/nav";

const sample = dict({
  en: { greet: "Hello {{name}}", only: "English only", price: "Total {{amount}}" },
  hi: { greet: "नमस्ते {{name}}", price: "कुल {{amount}}" },
});

describe("interpolate", () => {
  it("fills {{var}} slots, tolerating spaces inside the braces", () => {
    expect(interpolate("Pay {{amount}} — Success", { amount: "₹1,849" })).toBe("Pay ₹1,849 — Success");
    expect(interpolate("{{ n }} orders", { n: 3 })).toBe("3 orders");
  });

  it("leaves an unknown slot visible instead of blanking it", () => {
    expect(interpolate("Hi {{name}}", {})).toBe("Hi {{name}}");
    expect(interpolate("Hi {{name}}")).toBe("Hi {{name}}");
  });
});

describe("translate", () => {
  it("returns Hindi when present and English when the Hindi key is missing", () => {
    expect(translate(sample, "hi", "greet", { name: "Ramesh" })).toBe("नमस्ते Ramesh");
    expect(translate(sample, "hi", "only")).toBe("English only");
    expect(translate(sample, "en", "greet", { name: "Ramesh" })).toBe("Hello Ramesh");
  });

  it("keeps ₹ amounts as written in both languages", () => {
    expect(translate(sample, "hi", "price", { amount: "₹5,648" })).toBe("कुल ₹5,648");
    expect(translate(sample, "en", "price", { amount: "₹5,648" })).toBe("Total ₹5,648");
  });
});

describe("locale helpers", () => {
  it("maps locales to the voice tags Sarvam and the Web Speech API expect", () => {
    expect(voiceLangFor("hi")).toBe("hi-IN");
    expect(voiceLangFor("en")).toBe("en-IN");
    expect(voiceLangFor(undefined)).toBe("en-IN");
  });

  it("detects Devanagari text as Hindi", () => {
    expect(localeOfText("हर पैसा, लिखा हुआ।")).toBe("hi");
    expect(localeOfText("Every rupee, written down.")).toBe("en");
    expect(localeOfText("Banarasi Silk Saree ₹4,999 के लिए")).toBe("hi");
  });

  it("validates and flips locales", () => {
    expect(isLocale("hi")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(otherLocale("en")).toBe("hi");
    expect(otherLocale("hi")).toBe("en");
  });
});

describe("shipped dictionaries", () => {
  const dictionaries = { common, nav };

  it("have Hindi for every English key, written in Devanagari (no Latin-script Hinglish)", () => {
    for (const [name, d] of Object.entries(dictionaries)) {
      const hi = d.hi as Record<string, string | undefined>;
      for (const key of Object.keys(d.en)) {
        const value = hi[key];
        expect(value, `${name}.hi is missing "${key}"`).toBeTypeOf("string");
        // Brand names, model names, acronyms and {{slots}} are allowed to stay Latin.
        const stripped = (value as string)
          .replace(/\{\{\s*[A-Za-z0-9_.]+\s*\}\}/g, "")
          .replace(/AgentGate|Razorpay|Sarvam|GPT-4o|OpenAI|LLM|AI|Track 01|Hackathon|\/api\/stats/g, "")
          .replace(/[₹\d\s\p{P}©·]/gu, "");
        const latin = stripped.match(/[A-Za-z]{3,}/g) ?? [];
        // Any remaining Latin word means English leaked through, or Hinglish; both are rejected.
        expect(latin, `${name}.hi["${key}"] leaks Latin script: ${latin.join(", ")}`).toEqual([]);
      }
    }
  });

  it("keep every {{var}} slot that the English line has", () => {
    for (const [name, d] of Object.entries(dictionaries)) {
      const hi = d.hi as Record<string, string | undefined>;
      for (const [key, en] of Object.entries(d.en as Record<string, string>)) {
        const slots = (en.match(/\{\{\s*[A-Za-z0-9_.]+\s*\}\}/g) ?? []).sort();
        const hiSlots = (hi[key]?.match(/\{\{\s*[A-Za-z0-9_.]+\s*\}\}/g) ?? []).sort();
        expect(hiSlots, `${name}.hi["${key}"] slots differ`).toEqual(slots);
      }
    }
  });
});
