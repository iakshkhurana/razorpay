import type { CSSProperties } from "react";
import { ChatVerdict, FloatingCard, LedgerStamp } from "@/components/illustrations";
import { cn } from "@/lib/utils";

type FloatVars = CSSProperties & { "--delay"?: string; "--float-duration"?: string };

function floatStyle(delay: string, duration: string): FloatVars {
  return { "--delay": delay, "--float-duration": duration };
}

const ART_SHADOW = "w-full drop-shadow-[0_18px_28px_rgba(11,29,58,0.18)]";

/**
 * The hero's illustration cluster: a payment card, a chat bubble with its verdict
 * stamp and the open ledger, each floating on its own rhythm above a tilted
 * frosted pane. Decorative — the copy beside it carries the meaning.
 */
export function HeroCluster({ className }: { className?: string }) {
  return (
    <div className={cn("relative mx-auto aspect-[5/4] w-full max-w-[560px]", className)} aria-hidden="true">
      <div className="glass absolute inset-[9%] -rotate-3 rounded-[2rem] shadow-card" />
      <div className="absolute inset-[9%] rotate-2 rounded-[2rem] border border-white/40 bg-white/10" />

      <div className="float absolute left-0 top-[8%] w-[54%]" style={floatStyle("0s", "8s")}>
        <FloatingCard className={ART_SHADOW} />
      </div>
      <div className="float absolute right-0 top-0 w-[50%]" style={floatStyle("1.4s", "9s")}>
        <ChatVerdict className={ART_SHADOW} />
      </div>
      <div className="float absolute bottom-0 left-[17%] w-[66%]" style={floatStyle("2.6s", "7s")}>
        <LedgerStamp className={ART_SHADOW} />
      </div>
    </div>
  );
}
