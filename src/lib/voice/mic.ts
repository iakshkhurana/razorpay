"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/core";

/**
 * The buyer mic: records with MediaRecorder and transcribes through
 * `/api/stt` (Sarvam saarika); when the server has no key — or the upload
 * fails — the browser's own recognizer takes over. One consent flag is
 * shared by every mic in the app (DPDP-friendly: nothing records before
 * the user has said yes once, and the flag is theirs to clear).
 */

export const MIC_CONSENT_KEY = "agentgate.mic.consent";

export function hasMicConsent(): boolean {
  try {
    return window.localStorage.getItem(MIC_CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

export function grantMicConsent(): void {
  try {
    window.localStorage.setItem(MIC_CONSENT_KEY, "yes");
  } catch {
    /* consent lives in memory for this page */
  }
}

/* ---- browser recognizer (fallback path) --------------------------- */

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

async function transcribeBlob(blob: Blob, locale: Locale): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", blob, "audio.webm");
    const res = await fetch(`/api/stt?lang=${locale === "hi" ? "hi-IN" : "unknown"}`, { method: "POST", body: form });
    if (!res.ok) return null; // 404 = no server STT; caller falls back to the browser recognizer
    const data = (await res.json()) as { ok?: boolean; transcript?: string };
    return data.ok && typeof data.transcript === "string" ? data.transcript.trim() : "";
  } catch {
    return null;
  }
}

export type MicPhase = "idle" | "listening" | "transcribing";
export type MicIssue = "denied" | "noSpeech" | "failed" | null;

export interface MicInput {
  /** a recorder or a browser recognizer exists */
  supported: boolean;
  phase: MicPhase;
  issue: MicIssue;
  /** the shared consent flag has been granted */
  consented: boolean;
  grantConsent: () => void;
  /** begins listening (stops any agent speech via onStart) */
  start: () => Promise<void>;
  /** stops listening; the transcript is delivered to onTranscript */
  stop: () => void;
}

export interface MicInputOptions {
  locale: Locale;
  onTranscript: (text: string) => void;
  /** called the moment listening starts — the barge-in hook (stop agent playback here) */
  onStart?: () => void;
  /** hard cap on a single recording */
  maxMs?: number;
}

export function useMicInput({ locale, onTranscript, onStart, maxMs = 15_000 }: MicInputOptions): MicInput {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [issue, setIssue] = useState<MicIssue>(null);
  const [consented, setConsented] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const recognizer = useRef<RecognitionLike | null>(null);
  const stopTimer = useRef<number | null>(null);
  const unmounted = useRef(false);
  const optsRef = useRef({ locale, onTranscript, onStart });
  optsRef.current = { locale, onTranscript, onStart };

  useEffect(() => {
    setSupported(canRecord() || recognitionCtor() !== null);
    setConsented(hasMicConsent());
    return () => {
      unmounted.current = true;
      try {
        recorder.current?.stream.getTracks().forEach((t) => t.stop());
        recorder.current?.stop();
      } catch {
        /* already stopped */
      }
      try {
        recognizer.current?.abort();
      } catch {
        /* already stopped */
      }
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    };
  }, []);

  const grantConsent = useCallback(() => {
    grantMicConsent();
    setConsented(true);
  }, []);

  const deliver = useCallback((text: string) => {
    if (unmounted.current) return;
    setPhase("idle");
    if (text) optsRef.current.onTranscript(text);
    else setIssue("noSpeech");
  }, []);

  /** Browser recognizer path — used when recording or server STT is unavailable. */
  const startRecognizer = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setIssue("failed");
      setPhase("idle");
      return;
    }
    let rec: RecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setIssue("failed");
      setPhase("idle");
      return;
    }
    rec.lang = optsRef.current.locale === "hi" ? "hi-IN" : "en-IN";
    rec.continuous = false;
    rec.interimResults = false;
    let heard = "";
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r?.isFinal) heard += r[0]?.transcript ?? "";
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setIssue("denied");
      else if (e.error !== "aborted" && e.error !== "no-speech") setIssue("failed");
    };
    rec.onend = () => {
      recognizer.current = null;
      deliver(heard.trim());
    };
    recognizer.current = rec;
    try {
      rec.start();
    } catch {
      recognizer.current = null;
      setIssue("failed");
      setPhase("idle");
    }
  }, [deliver]);

  const start = useCallback(async () => {
    if (phase !== "idle") return;
    setIssue(null);
    optsRef.current.onStart?.(); // barge-in: the agent goes quiet the moment the user speaks
    setPhase("listening");

    if (!canRecord()) {
      startRecognizer();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (unmounted.current) return;
      setIssue("denied");
      setPhase("idle");
      return;
    }
    if (unmounted.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      startRecognizer();
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      if (stopTimer.current !== null) {
        window.clearTimeout(stopTimer.current);
        stopTimer.current = null;
      }
      if (unmounted.current) return;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (blob.size === 0) {
        deliver("");
        return;
      }
      setPhase("transcribing");
      void transcribeBlob(blob, optsRef.current.locale).then((text) => {
        if (unmounted.current) return;
        if (text === null) {
          // No server STT — one retry through the browser recognizer, live.
          setPhase("listening");
          startRecognizer();
          return;
        }
        deliver(text);
      });
    };
    recorder.current = rec;
    try {
      rec.start();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      startRecognizer();
      return;
    }
    stopTimer.current = window.setTimeout(() => {
      try {
        recorder.current?.stop();
      } catch {
        /* already stopped */
      }
    }, maxMs);
  }, [deliver, maxMs, phase, startRecognizer]);

  const stop = useCallback(() => {
    try {
      recorder.current?.stop();
    } catch {
      /* not recording */
    }
    try {
      recognizer.current?.stop();
    } catch {
      /* not listening */
    }
  }, []);

  return { supported, phase, issue, consented, grantConsent, start, stop };
}
