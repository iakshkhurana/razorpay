"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/demo/client";
import { detectLang, isSpeechSupported, speakBrowser, stopBrowser, toSpeakable, type SpeechLang } from "./tts";

/**
 * One voice for the whole app. State lives in a tiny module store so the
 * toggle in the top bar and the chat pane that speaks share `enabled`, one
 * playback queue and one stop(). Nothing here runs during the first render:
 * storage, speech support and the server's provider are read in an effect.
 */

export type VoiceProvider = "sarvam" | "browser" | "none";

export interface AgentVoice {
  enabled: boolean;
  toggle: () => void;
  /**
   * Queues `text`; resolves when it has been spoken (or skipped).
   * `lang` defaults to script detection: Devanagari → "hi-IN", anything else → "en-IN".
   * The same tag is what Sarvam receives as target_language_code via /api/tts.
   */
  speak: (text: string, lang?: SpeechLang) => Promise<void>;
  stop: () => void;
  /** the browser can speak on its own */
  supported: boolean;
  provider: VoiceProvider;
}

export const VOICE_STORAGE_KEY = "agentgate.voice";

interface VoiceState {
  hydrated: boolean;
  enabled: boolean;
  supported: boolean;
  server: "sarvam" | "browser" | null;
}

const INITIAL: VoiceState = { hydrated: false, enabled: false, supported: false, server: null };
let state: VoiceState = INITIAL;
const listeners = new Set<() => void>();

function update(patch: Partial<VoiceState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

function readStored(): boolean | null {
  try {
    const raw = window.localStorage.getItem(VOICE_STORAGE_KEY);
    return raw === null ? null : raw === "on";
  } catch {
    return null;
  }
}
function writeStored(on: boolean): void {
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: the choice lives in memory for this page */
  }
}

let serverReady: Promise<void> = Promise.resolve();

function hydrate(): void {
  if (state.hydrated) return;
  const supported = isSpeechSupported();
  const stored = readStored();
  update({ hydrated: true, supported, enabled: stored ?? supported });

  serverReady = api
    .stats()
    .then((s) => {
      const server = s.modes.voice === "sarvam" ? "sarvam" : "browser";
      // Default ON when any provider exists; a browser without voices still plays Sarvam audio.
      const enabled = readStored() === null && server === "sarvam" ? true : state.enabled;
      update({ server, enabled });
    })
    .catch(() => update({ server: "browser" }));

  window.addEventListener("storage", (e) => {
    if (e.key === VOICE_STORAGE_KEY) update({ enabled: e.newValue === "on" });
  });
}

function providerOf(s: VoiceState): VoiceProvider {
  if (s.server === "sarvam") return "sarvam";
  return s.supported ? "browser" : "none";
}

/* ------------------------------------------------------------------ */
/*  Playback                                                           */
/* ------------------------------------------------------------------ */

let queue: Promise<void> = Promise.resolve();
/** Bumped by stop(); anything queued under an older epoch is skipped. */
let epoch = 0;
let current: { cancel: () => void } | null = null;

/** Plays a WAV blob through an audio element. Resolves true when it played to the end. */
function playBlob(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(blob);
    } catch {
      resolve(false);
      return;
    }
    const audio = new Audio();
    let settled = false;
    const finish = (played: boolean) => {
      if (settled) return;
      settled = true;
      if (current?.cancel === cancel) current = null;
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
      resolve(played);
    };
    const cancel = () => {
      try {
        audio.pause();
      } catch {
        /* not playing */
      }
      finish(true);
    };
    current = { cancel };
    audio.preload = "auto";
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.src = url;
    audio.play().catch(() => finish(false));
  });
}

async function speakNow(text: string, lang: SpeechLang, myEpoch: number): Promise<void> {
  if (myEpoch !== epoch || !state.enabled) return;
  const spoken = toSpeakable(text, lang);
  if (!spoken) return;

  await serverReady;
  if (myEpoch !== epoch || !state.enabled) return;

  if (state.server === "sarvam") {
    let blob: Blob | null = null;
    try {
      blob = await api.tts(spoken, lang);
    } catch {
      blob = null; // upstream trouble: browser voices take over
    }
    if (myEpoch !== epoch || !state.enabled) return;
    if (blob && (await playBlob(blob))) return;
    if (myEpoch !== epoch || !state.enabled) return;
  }
  if (state.supported) await speakBrowser(spoken, lang);
}

/**
 * The language a line is spoken in. The script wins over the hint: Devanagari
 * text asked for as "en-IN" would be read letter-by-letter by an English
 * voice, so it goes to the Hindi voice regardless. English text keeps the
 * caller's hint (a Hindi voice reads English well enough for a mixed line).
 */
export function resolveSpeechLang(text: string, hint?: SpeechLang): SpeechLang {
  const detected = detectLang(text);
  if (detected === "hi-IN") return "hi-IN";
  return hint ?? detected;
}

function speak(text: string, lang?: SpeechLang): Promise<void> {
  const myEpoch = epoch;
  const resolved = resolveSpeechLang(text, lang);
  const run = queue.then(() => speakNow(text, resolved, myEpoch)).catch(() => undefined);
  queue = run;
  return run;
}

function stop(): void {
  epoch += 1;
  current?.cancel();
  stopBrowser();
}

function toggle(): void {
  const next = !state.enabled;
  writeStored(next);
  update({ enabled: next });
  if (!next) stop();
}

export function useAgentVoice(): AgentVoice {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    hydrate();
  }, []);
  return { enabled: snapshot.enabled, supported: snapshot.supported, provider: providerOf(snapshot), toggle, speak, stop };
}
