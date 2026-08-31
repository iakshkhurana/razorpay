import { describe, expect, it } from "vitest";

process.env.AGENTGATE_DB_PATH = ":memory:";
delete process.env.OPENAI_API_KEY;

import { POST as vision } from "./onboard/vision/route";
import { POST as stt } from "./stt/route";

function req(url: string, init: RequestInit): Request {
  return new Request(`http://localhost:3000${url}`, init);
}

describe("vision route", () => {
  it("answers 501 with the manual fallback when no key is configured", async () => {
    const res = await vision(req("/api/onboard/vision", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([1, 2, 3]) }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { fallback?: string };
    expect(body.fallback).toBe("manual");
  });
});

describe("stt route", () => {
  it("answers 404 browser-fallback when no Sarvam key is configured", async () => {
    const prev = process.env.SARVAM_API_KEY;
    delete process.env.SARVAM_API_KEY;
    const res = await stt(req("/api/stt", { method: "POST", headers: { "content-type": "audio/wav" }, body: new Uint8Array([0, 1]) }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { fallback?: string }).fallback).toBe("browser");
    if (prev !== undefined) process.env.SARVAM_API_KEY = prev;
  });
});
