"use client";

import { useAgentVoice } from "@/lib/voice/useAgentVoice";
import { cn } from "@/lib/utils";

/**
 * Pill that mutes or unmutes the agents' voice. Renders nothing when the
 * browser cannot speak and the server has no voice provider either.
 */

export interface AgentVoiceToggleProps {
  className?: string;
  /** "dark" sits on the navy top bar; "light" on white or mist surfaces */
  tone?: "light" | "dark";
}

export function AgentVoiceToggle({ className, tone = "light" }: AgentVoiceToggleProps) {
  const { enabled, toggle, supported, provider } = useAgentVoice();
  if (!supported && provider !== "sarvam") return null;

  const label = !enabled ? "Voice off" : provider === "sarvam" ? "Voice on · Sarvam" : "Voice on";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      title={enabled ? "Mute the agents" : "Let the agents speak"}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3395FF] focus-visible:ring-offset-2",
        tone === "dark"
          ? cn(
              "focus-visible:ring-offset-[#0B1D3A]",
              enabled ? "border-white/25 bg-white/15 text-white hover:bg-white/20" : "border-white/15 bg-transparent text-white/75 hover:text-white",
            )
          : cn(
              "focus-visible:ring-offset-white",
              enabled
                ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                : "border-[#E3EAF5] bg-white text-[#5B6B8C] hover:border-[#C9D6EC] hover:text-[#14213D]",
            ),
        className,
      )}
    >
      <SpeakerIcon muted={!enabled} />
      <span>{label}</span>
    </button>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      {muted ? (
        <>
          <path d="m22 9-6 6" />
          <path d="m16 9 6 6" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  );
}
