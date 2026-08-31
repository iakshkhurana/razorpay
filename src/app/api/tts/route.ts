import { z } from "zod";
import { json, parseBody, rateLimit } from "@/lib/api";
import { recordVoiceCall } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * Indic text-to-speech for the agents' voice. With SARVAM_API_KEY set the
 * text goes to Sarvam AI and WAV bytes come back; without it (or on any
 * upstream trouble) the client gets a 404 and speaks with browser voices.
 * The key is read from the environment and never logged or echoed.
 */

const SARVAM_URL = "https://api.sarvam.ai/text-to-speech";
const UPSTREAM_TIMEOUT_MS = 8000;

const TtsBodySchema = z.object({
  text: z.string().trim().min(1).max(1500),
  lang: z.enum(["en-IN", "hi-IN"]),
  speaker: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,40}$/i, "speaker must be a plain voice name")
    .optional(),
});

function browserFallback() {
  return json({ ok: false, fallback: "browser" }, 404);
}

function callSarvam(key: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  return fetch(SARVAM_URL, {
    method: "POST",
    headers: { "api-subscription-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
    signal,
    cache: "no-store",
  });
}

/** Sarvam has answered as `{ audios: [base64] }` and as `{ audio: base64 }`; accept both. */
function extractAudio(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { audios?: unknown; audio?: unknown };
  if (Array.isArray(d.audios) && typeof d.audios[0] === "string" && d.audios[0]) return d.audios[0];
  if (typeof d.audio === "string" && d.audio) return d.audio;
  return null;
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "tts", 120);
  if (limited) return limited;
  const body = await parseBody(req, TtsBodySchema);
  if (!body.ok) return body.response;

  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) return browserFallback();

  const { text, lang, speaker } = body.data;
  const settings = {
    target_language_code: lang,
    speaker: speaker ?? "priya",
    model: "bulbul:v3",
    pace: 0.95,
    speech_sample_rate: 22050,
  };

  const started = Date.now();
  try {
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    let res = await callSarvam(key, { text, ...settings }, signal);
    if (res.status === 400 || res.status === 422) {
      // Earlier API revisions took the text as `inputs: [text]`.
      res = await callSarvam(key, { inputs: [text], ...settings }, signal);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[tts] Sarvam ${res.status}: ${detail.slice(0, 200)}`);
      return browserFallback();
    }

    const audio = extractAudio(await res.json());
    if (!audio) return browserFallback();
    const bytes = Buffer.from(audio, "base64");
    if (!bytes.length) return browserFallback();

    recordVoiceCall("tts", Date.now() - started, true, text.length);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "audio/wav", "cache-control": "no-store", "content-length": String(bytes.length) },
    });
  } catch {
    return browserFallback();
  }
}
