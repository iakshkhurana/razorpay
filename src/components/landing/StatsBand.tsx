"use client";

import { Stat } from "@/components/ui/stat";
import type { StatsResponse } from "@/lib/demo/client";

export interface StatsBandProps {
  /** null while the first fetch is in flight or after it failed */
  stats: StatsResponse | null;
  loading: boolean;
}

function signedPct(n: number): string {
  const rounded = Math.round(n);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 9.8" />
    </svg>
  );
}

function SpeechGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8.5 9h7M8.5 12h4" />
    </svg>
  );
}

function TrendGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 17.5 10 11l4 4 6-7" />
      <path d="M15.5 8H20v4.5" />
    </svg>
  );
}

function ChainGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.5 6.8" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.1-1.1" />
    </svg>
  );
}

/**
 * Four evidence tiles fed by /api/stats. Skeletons while the first fetch runs;
 * nothing at all until an eval run exists — never an invented number.
 */
export function StatsBand({ stats, loading }: StatsBandProps) {
  const ev = stats?.eval ?? null;
  if (!loading && !ev) return null;

  const chainIntact = stats?.stats.ledger_intact ?? true;
  const ledgerCount = stats?.stats.ledger_count ?? 0;
  const headHash = stats?.stats.head_hash ?? "";
  const brokenAt = stats?.stats.ledger_broken_at ?? null;

  return (
    <section aria-label="Evidence from the last eval run" className="relative z-10 -mt-12 px-4 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy={loading || undefined}>
          <Stat
            label="Breaches"
            value={ev ? String(ev.breaches) : "—"}
            hint={ev ? `across ${ev.attacks} red-team attacks` : undefined}
            tone={ev && ev.breaches === 0 ? "green" : "red"}
            icon={<ShieldGlyph />}
            loading={loading}
          />
          <Stat
            label="Explained"
            value={ev ? `${Math.round(ev.explained_pct)}%` : "—"}
            hint="money actions carrying a human reason"
            tone="blue"
            icon={<SpeechGlyph />}
            loading={loading}
          />
          <Stat
            label="Revenue"
            value={ev ? signedPct(ev.revenue_uplift_pct) : "—"}
            hint="vs a static store, 100 seeded buyers"
            tone={ev && ev.revenue_uplift_pct >= 0 ? "green" : "red"}
            icon={<TrendGlyph />}
            loading={loading}
          />
          <Stat
            label="Ledger chain"
            value={chainIntact ? "Intact" : "Broken"}
            hint={
              chainIntact
                ? `${ledgerCount} entries · head ${headHash.slice(0, 10) || "—"}…`
                : `tamper flagged at row ${brokenAt ?? "?"}`
            }
            tone={chainIntact ? "green" : "red"}
            icon={<ChainGlyph />}
            loading={loading}
          />
        </div>
        {ev ? (
          <p className="mt-3 text-xs text-rzp-muted">
            Criterion-coverage on synthetic sessions with a scripted adversary; not a market claim. Every figure comes from the last <code className="font-mono">npm run eval</code>.
          </p>
        ) : null}
      </div>
    </section>
  );
}
