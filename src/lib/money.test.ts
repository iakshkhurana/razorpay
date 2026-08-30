import { describe, expect, it } from "vitest";
import { formatINR, groupIndian, pct, rupeesToPaise } from "./money";

describe("money", () => {
  it("groups digits the Indian way", () => {
    expect(groupIndian(0)).toBe("0");
    expect(groupIndian(999)).toBe("999");
    expect(groupIndian(1849)).toBe("1,849");
    expect(groupIndian(100000)).toBe("1,00,000");
    expect(groupIndian(1234567)).toBe("12,34,567");
  });

  it("formats paise as rupees with the ₹ sign", () => {
    expect(formatINR(184900)).toBe("₹1,849");
    expect(formatINR(499900)).toBe("₹4,999");
    expect(formatINR(1000000)).toBe("₹10,000");
    expect(formatINR(184950)).toBe("₹1,849.50");
    expect(formatINR(-35000)).toBe("-₹350");
  });

  it("shows paise when asked", () => {
    expect(formatINR(184900, { showPaise: true })).toBe("₹1,849.00");
  });

  it("converts rupees to integer paise", () => {
    expect(rupeesToPaise(1499)).toBe(149900);
    expect(rupeesToPaise(12.5)).toBe(1250);
  });

  it("computes percentages to one decimal", () => {
    expect(pct(350, 1499)).toBe(23.3);
    expect(pct(1, 0)).toBe(0);
  });
});
