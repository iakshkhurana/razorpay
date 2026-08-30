"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Round mic button on the Web Speech API (hi-IN). Renders nothing when the
 * browser has no recognizer or the user refuses the mic: voice only edits
 * policy fields before approval, so it never blocks the flow.
 *
 * Look: blue ring while idle, red pulse while listening.
 */

interface AlternativeLike {
  transcript: string;
}
interface ResultLike {
  isFinal: boolean;
  0: AlternativeLike;
}
interface ResultEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: ResultLike };
}
interface ErrorEventLike {
  error: string;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((e: ResultEventLike) => void) | null;
  onerror: ((e: ErrorEventLike) => void) | null;
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

export interface VoiceMicProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  /** helper text shown beside the mic while idle */
  label?: string;
  className?: string;
}

export function VoiceMic({
  onTranscript,
  disabled = false,
  label = "Boliye: 'minimum price 85% se kam mat karna'",
  className,
}: VoiceMicProps) {
  const [supported, setSupported] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const recognizer = useRef<RecognitionLike | null>(null);
  const finalText = useRef("");
  const interimText = useRef("");
  const unmounted = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => {
      unmounted.current = true;
      try {
        recognizer.current?.abort();
      } catch {
        /* already stopped */
      }
    };
  }, []);

  const start = useCallback(() => {
    if (recognizer.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    let rec: RecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setHidden(true);
      return;
    }
    rec.lang = "hi-IN";
    rec.continuous = false;
    rec.interimResults = true;
    finalText.current = "";
    interimText.current = "";
    setInterim("");
    setNote(null);

    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let finals = "";
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        const t = r?.[0]?.transcript ?? "";
        if (r?.isFinal) finals += t;
        else partial += t;
      }
      if (finals) finalText.current += finals;
      interimText.current = partial;
      setInterim(partial);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setHidden(true);
      } else if (e.error === "no-speech") {
        setNote("Kuch sunayi nahi diya. Mic dabakar dobara boliye.");
      } else if (e.error !== "aborted") {
        setNote("Mic ne kaam nahi kiya. Dobara try karein ya sliders use karein.");
      }
    };
    rec.onend = () => {
      recognizer.current = null;
      const text = (finalText.current || interimText.current).trim();
      finalText.current = "";
      interimText.current = "";
      if (unmounted.current) return;
      setListening(false);
      setInterim("");
      if (text) onTranscriptRef.current(text);
    };

    recognizer.current = rec;
    try {
      rec.start();
    } catch {
      recognizer.current = null;
      setListening(false);
      setNote("Mic ne kaam nahi kiya. Dobara try karein ya sliders use karein.");
    }
  }, []);

  const stop = useCallback(() => {
    try {
      recognizer.current?.stop();
    } catch {
      setListening(false);
    }
  }, []);

  if (!supported || hidden) return null;

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <button
        type="button"
        onClick={listening ? stop : start}
        disabled={disabled}
        aria-pressed={listening}
        aria-label={listening ? "Sunna band karein" : "Boliye — policy ko awaaz se set karein"}
        className={cn(
          "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 bg-white transition-[color,border-color,background-color,box-shadow] duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          "disabled:cursor-not-allowed disabled:opacity-50",
          listening
            ? "animate-mic-pulse border-rzp-red bg-rzp-red/10 text-[#B3262C]"
            : "border-rzp-blue text-rzp-blueDeep shadow-[0_0_0_4px_rgba(51,149,255,0.14)] hover:bg-rzp-blue/10 hover:shadow-[0_0_0_6px_rgba(51,149,255,0.18)]",
        )}
      >
        <MicIcon />
      </button>
      <div className="min-w-0 text-sm" aria-live="polite">
        {listening ? (
          <>
            <p className="font-medium text-[#B3262C]">Sun raha hoon…</p>
            {interim ? <p className="truncate text-rzp-muted">{interim}</p> : null}
          </>
        ) : (
          <p className="text-rzp-muted">{label}</p>
        )}
        {note && !listening ? <p className="mt-0.5 text-xs text-[#B3262C]">{note}</p> : null}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8.5 21h7" />
    </svg>
  );
}
