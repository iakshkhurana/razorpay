import { afterEach, describe, expect, it } from "vitest";
import { _resetRateLimits, rateLimit } from "./api";

function reqFrom(ip: string): Request {
  return new Request("http://localhost/api/test", { method: "POST", headers: { "x-forwarded-for": ip } });
}

describe("rateLimit", () => {
  afterEach(() => {
    _resetRateLimits();
  });

  it("lets a client through up to the limit and then answers 429", () => {
    const req = reqFrom("10.0.0.1");
    for (let i = 0; i < 5; i += 1) {
      expect(rateLimit(req, "chat", 5)).toBeNull();
    }
    const blocked = rateLimit(req, "chat", 5);
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("keeps buckets separate per client and per name", () => {
    const a = reqFrom("10.0.0.1");
    const b = reqFrom("10.0.0.2");
    expect(rateLimit(a, "chat", 1)).toBeNull();
    // same client, different bucket: untouched
    expect(rateLimit(a, "tts", 1)).toBeNull();
    // different client, same bucket: untouched
    expect(rateLimit(b, "chat", 1)).toBeNull();
    // same client, same bucket: spent
    expect(rateLimit(a, "chat", 1)?.status).toBe(429);
  });

  it("opens a fresh window once the old one expires", () => {
    const req = reqFrom("10.0.0.3");
    // windowMs 0 → the window is already over by the next call
    expect(rateLimit(req, "chat", 1, 0)).toBeNull();
    expect(rateLimit(req, "chat", 1, 0)).toBeNull();
  });

  it("falls back to a shared key when no forwarded header exists", () => {
    const bare = new Request("http://localhost/api/test", { method: "POST" });
    expect(rateLimit(bare, "chat", 1)).toBeNull();
    expect(rateLimit(bare, "chat", 1)?.status).toBe(429);
  });
});
