"use client";

/**
 * Browser speech for the agents (Web Speech API, speechSynthesis).
 *
 * Chromium loads its voice list lazily, so pickVoice re-reads the list on every
 * call and speakBrowser waits briefly for `voiceschanged` before the first
 * utterance. Long replies are chunked at sentence boundaries: Chromium cuts
 * single utterances off after ~15 seconds.
 */

export type SpeechLang = "en-IN" | "hi-IN";

export interface SpeakOptions {
  /** 0.1–10, default 1.0 */
  rate?: number;
  /** 0–2, default 1.0 */
  pitch?: number;
}

const CHUNK_MAX = 200;

/** Utterances stay referenced until they finish: Chromium never fires onend on a collected one. */
const live = new Set<SpeechSynthesisUtterance>();
let generation = 0;

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

function listVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices() ?? [];
  } catch {
    return [];
  }
}

/** Resolves with the voice list once the browser has one, or after `timeoutMs`. */
export function waitForVoices(timeoutMs = 600): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const now = listVoices();
    if (now.length || !isSpeechSupported()) {
      resolve(now);
      return;
    }
    const synth = window.speechSynthesis;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", finish);
      resolve(listVoices());
    };
    const timer = window.setTimeout(finish, timeoutMs);
    synth.addEventListener("voiceschanged", finish);
  });
}

/**
 * Higher is better; 0 means "not eligible". Indian voices win: an exact
 * en-IN / hi-IN tag first, then names that say India/Hindi, then the
 * neural voices from Google and Microsoft. For Hindi, Indian English is an
 * acceptable stand-in (it reads Hinglish far better than a US voice).
 */
function scoreVoice(voice: SpeechSynthesisVoice, lang: SpeechLang): number {
  const name = voice.name.toLowerCase();
  const tag = voice.lang.toLowerCase().replace("_", "-");
  const want = lang.toLowerCase();
  const base = want.slice(0, 2);

  let score = 0;
  if (tag === want) score += 40;
  else if (tag === base || tag.startsWith(`${base}-`)) score += 12;
  else if (base === "hi" && tag.startsWith("en-in")) score += 6;
  else return 0;

  if (/india|hindi|en-in|hi-in/.test(name)) score += 20;
  if (/neural|natural|online|premium|enhanced/.test(name)) score += 8;
  if (/google|microsoft/.test(name)) score += 5;
  if (voice.default) score += 1;
  return score;
}

/** The best available voice for the language, or null to let the browser choose by `lang`. */
export function pickVoice(lang: SpeechLang): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  for (const voice of listVoices()) {
    const score = scoreVoice(voice, lang);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/** 'hi-IN' when the text carries Devanagari, else 'en-IN'. */
export function detectLang(text: string): SpeechLang {
  return /[ऀ-ॿ]/.test(text) ? "hi-IN" : "en-IN";
}

/**
 * Strips what a voice should not read aloud (emoji, markdown marks) and turns
 * "₹1,849" into "1,849 rupees" / "1,849 rupaye" — voices skip the glyph.
 */
export function toSpeakable(text: string, lang: SpeechLang): string {
  const rupee = lang === "hi-IN" ? "rupaye" : "rupees";
  return (
    text
      // never read machine noise aloud: URLs, ids, hashes
      .replace(/\bhttps?:\/\/\S+/gi, " ")
      .replace(/\b(?:www\.|rzp\.io\/)\S+/gi, " ")
      .replace(/\b(?:ord|off|mnd|ses|plink|pay|mockpay|eval)_[A-Za-z0-9_-]+/g, " ")
      .replace(/\b[0-9a-f]{12,}\b/gi, " ")
      .replace(/\(\s*\)/g, " ")
      .replace(/\p{Extended_Pictographic}/gu, " ")
      .replace(/[️‍]/g, "")
      .replace(/[*_`#>~]+/g, " ")
      .replace(/₹\s?([\d,]+(?:\.\d+)?)/g, `$1 ${rupee}`)
      .replace(/₹/g, ` ${rupee} `)
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,!?।])/g, "$1")
      .trim()
  );
}

function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let current = "";
  for (const word of sentence.split(" ")) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= max) current += ` ${word}`;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Sentence-boundary chunks (. ! ? and the Devanagari danda), each at most `max` characters. */
export function chunkText(text: string, max = CHUNK_MAX): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const sentences = (clean.match(/[^.!?।]+[.!?।]*/g) ?? [clean]).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    for (const piece of splitLong(sentence, max)) {
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= max) current += ` ${piece}`;
      else {
        out.push(current);
        current = piece;
      }
    }
  }
  if (current) out.push(current);
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function speakChunk(
  synth: SpeechSynthesis,
  chunk: string,
  lang: SpeechLang,
  voice: SpeechSynthesisVoice | null,
  opts: SpeakOptions,
  gen: number,
): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    utterance.rate = opts.rate ?? 1.0;
    utterance.pitch = opts.pitch ?? 1.0;
    live.add(utterance);

    let started = false;
    let done = false;
    const startedAt = Date.now();
    const budgetMs = chunk.length * 150 + 4000;
    const finish = () => {
      if (done) return;
      done = true;
      live.delete(utterance);
      window.clearInterval(watchdog);
      resolve();
    };
    utterance.onstart = () => {
      started = true;
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    // Chromium sometimes drops onend after cancel(); the watchdog keeps the queue moving.
    const watchdog = window.setInterval(() => {
      if (gen !== generation || (started && !synth.speaking) || Date.now() - startedAt > budgetMs) finish();
    }, 250);

    try {
      synth.speak(utterance);
    } catch {
      finish();
    }
  });
}

/**
 * Speaks `text` with the browser, cancelling whatever was speaking before.
 * Resolves when the last chunk ends, or at once when a newer call or
 * stopBrowser() supersedes this one.
 */
export async function speakBrowser(text: string, lang: SpeechLang, opts: SpeakOptions = {}): Promise<void> {
  if (!isSpeechSupported()) return;
  const chunks = chunkText(text);
  if (!chunks.length) return;

  const gen = ++generation;
  const synth = window.speechSynthesis;
  let wasSpeaking = false;
  try {
    wasSpeaking = synth.speaking || synth.pending;
    synth.cancel();
  } catch {
    /* nothing was speaking */
  }
  // A speak() right behind cancel() is dropped by Chromium now and then.
  if (wasSpeaking) await delay(40);
  await waitForVoices();
  if (gen !== generation) return;

  const voice = pickVoice(lang);
  for (const chunk of chunks) {
    if (gen !== generation) return;
    await speakChunk(synth, chunk, lang, voice, opts, gen);
  }
}

/** Cancels the current browser utterance and anything queued behind it. */
export function stopBrowser(): void {
  generation += 1;
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing was speaking */
  }
}
