import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "ink" | "money" | "turmeric" | "violet" | "deny" | "action";

const TONE: Record<Tone, string> = {
  ink: "border-ink/20 text-ink/80",
  money: "border-money/40 text-money",
  turmeric: "border-turmeric/50 text-turmeric",
  violet: "border-violet/50 text-violet",
  deny: "border-deny/50 text-deny",
  action: "border-action/40 text-action",
};

export function Badge({
  tone = "ink",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
