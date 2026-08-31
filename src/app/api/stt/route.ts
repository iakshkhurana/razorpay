import { error, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Speech-to-text for the buyer mic. Audio goes to Sarvam `saarika:v2.5`
 * (probed live: multipart `file` + `model` + `language_code`, response
 * `{ transcript, language_code, language_probability }`). Without a key —
 * or on any upstream trouble — the client falls back to the browser's own
 * recognizer, so this route answers 404 `{ fallback: "browser" }` instead
 * of failing the demo. The key never leaves the server.
 */

const SARVAM_URL = "https://api.sarvam.ai/speech-to-text";
const STT_MODEL = "saarika:v2.5";
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

const LANGS = new Set(["unknown", "hi-IN", "en-IN"]);

function browserFallback() {
  return json({ ok: false, fallback: "browser" }, 404);
}

export async function POST(req: Request) {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) return browserFallback();

  let audio: Blob | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof Blob) audio = file;
    } else if (contentType.startsWith("audio/")) {
      audio = new Blob([await req.arrayBuffer()], { type: contentType });
    }
  } catch {
    audio = null;
  }
  if (!audio || audio.size === 0) return error("Send the recording as multipart `file` or a raw audio body.", 400);
  if (audio.size > MAX_AUDIO_BYTES) return error("The recording is too long. Keep it under a few seconds.", 413);

  const url = new URL(req.url);
  const langParam = url.searchParams.get("lang") ?? "unknown";
  const language_code = LANGS.has(langParam) ? langParam : "unknown";

  const body = new FormData();
  const name = audio.type.includes("wav") ? "audio.wav" : audio.type.includes("ogg") ? "audio.ogg" : "audio.webm";
  body.append("file", audio, name);
  body.append("model", STT_MODEL);
  body.append("language_code", language_code);

  try {
    const res = await fetch(SARVAM_URL, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[stt] Sarvam ${res.status}: ${detail.slice(0, 200)}`);
      return browserFallback();
    }
    const data = (await res.json()) as { transcript?: unknown; language_code?: unknown };
    const transcript = typeof data.transcript === "string" ? data.transcript.trim() : "";
    return json({
      ok: true,
      transcript,
      language_code: typeof data.language_code === "string" ? data.language_code : null,
    });
  } catch (err) {
    console.warn(`[stt] upstream failed: ${err instanceof Error ? err.message : "error"}`);
    return browserFallback();
  }
}
