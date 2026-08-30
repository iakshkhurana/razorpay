"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/money";
import { VerdictStamp } from "./VerdictStamp";

export interface LedgerRow {
  id: string;
  ts: string;
  actor: string;
  mandate_id: string;
  action: string;
  amount_paise: number;
  verdict: string;
  reason_code: string;
  human_reason: string;
  policy_checks?: Array<{ rule: string; result: string; detail: string }>;
  prev_hash: string;
  hash: string;
  plain?: string | null;
}

export type LedgerView = "shopkeeper" | "tech";

export interface LedgerBookProps {
  entries: LedgerRow[];
  view: LedgerView;
  /** newest entries first */
  emptyText?: string;
  className?: string;
  maxHeight?: string;
  compact?: boolean;
}

function timeOf(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortHash(h: string): string {
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

/**
 * The Living Bahi-Khata: an open account book with a maroon spine, ruled lines,
 * entries written in with a slide+fade, amounts right-aligned in mono and every
 * verdict pressed on as a stamp. The view toggle flips the page.
 */
export function LedgerBook({ entries, view, emptyText, className, maxHeight = "60vh", compact = false }: LedgerBookProps) {
  const [flipKey, setFlipKey] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFlipKey((k) => k + 1);
  }, [view]);

  useEffect(() => {
    const incoming = entries.filter((e) => !seen.current.has(e.id)).map((e) => e.id);
    if (incoming.length === 0) return;
    const first = seen.current.size === 0;
    incoming.forEach((id) => seen.current.add(id));
    if (first) return;
    setFresh(new Set(incoming));
    const t = window.setTimeout(() => setFresh(new Set()), 600);
    return () => window.clearTimeout(t);
  }, [entries]);

  const shopkeeper = view === "shopkeeper";

  return (
    <section
      aria-label={shopkeeper ? "Ledger, shopkeeper view" : "Ledger, technical view"}
      className={cn("ledger-spine rounded-xl border border-ink/10 bg-white/50 pl-[6px]", className)}
    >
      <div
        key={flipKey}
        className={cn("animate-page-flip overflow-y-auto rounded-r-xl", shopkeeper ? "ruled-paper" : "grid-paper")}
        style={{ maxHeight }}
      >
        {entries.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink/70">{emptyText ?? "Ledger abhi khaali hai — run the demo buyer to write the first entry."}</p>
        ) : (
          <ol className="divide-y divide-ink/5">
            {entries.map((e) => (
              <li
                key={e.id}
                className={cn("px-4 sm:px-5", compact ? "py-2.5" : "py-3.5", fresh.has(e.id) && "animate-write-in")}
              >
                {shopkeeper ? (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className={cn("leading-snug", compact ? "text-sm" : "text-base")}>{e.plain ?? e.human_reason}</p>
                      <p className="mt-1 text-xs text-ink/70">{timeOf(e.ts)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="font-mono text-sm tnum">{e.amount_paise ? formatINR(e.amount_paise) : ""}</span>
                      <VerdictStamp kind={e.verdict} size="sm" animate={fresh.has(e.id)} />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed text-ink/80">
                      <div className="flex flex-wrap gap-x-3 text-ink/70">
                        <span>{timeOf(e.ts)}</span>
                        <span>{e.actor}</span>
                        <span>{e.action}</span>
                        <span title={e.mandate_id}>{e.mandate_id ? e.mandate_id.slice(0, 14) : "—"}</span>
                      </div>
                      <div className="mt-1 text-ink">
                        {e.reason_code} · {e.human_reason}
                      </div>
                      {e.policy_checks && e.policy_checks.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                          {e.policy_checks.map((c) => (
                            <span
                              key={`${e.id}-${c.rule}`}
                              className={cn(
                                c.result === "fail" ? "text-deny" : c.result === "skip" ? "text-ink/70" : "text-money",
                              )}
                            >
                              {c.result === "fail" ? "✗" : c.result === "skip" ? "·" : "✓"} {c.rule}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-1 text-ink/70">
                        {shortHash(e.prev_hash)} → {shortHash(e.hash)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="font-mono text-sm tnum">{e.amount_paise ? formatINR(e.amount_paise) : ""}</span>
                      <VerdictStamp kind={e.verdict} size="sm" animate={fresh.has(e.id)} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
