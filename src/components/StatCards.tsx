"use client";

import { Card } from "@/components/ui/card";
import type { StatsResponse } from "@/lib/demo/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

type Stats = StatsResponse["stats"];

export interface StatCardsProps {
  /** null while the first poll is still in flight */
  stats: Stats | null;
  className?: string;
}

function shortHash(h: string): string {
  if (!h || h.length < 12) return "—";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

interface StatCardProps {
  label: string;
  value: string;
  caption?: string;
  valueClassName?: string;
  captionClassName?: string;
  loading?: boolean;
}

function StatCard({ label, value, caption, valueClassName, captionClassName, loading }: StatCardProps) {
  return (
    <Card className="px-5 py-4" aria-busy={loading || undefined}>
      <dt className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/70">{label}</dt>
      <dd className={cn("mt-2 font-mono text-3xl font-semibold leading-none tnum", loading ? "text-ink/70" : "text-ink", valueClassName)}>
        {loading ? "—" : value}
      </dd>
      {caption ? <dd className={cn("mt-2 text-xs text-ink/70", captionClassName)}>{loading ? " " : caption}</dd> : null}
    </Card>
  );
}

/**
 * The four numbers a shopkeeper reads first: what the AI sold, what it added on,
 * what the gate stopped, and whether the book still adds up.
 */
export function StatCards({ stats, className }: StatCardsProps) {
  const loading = stats === null;
  const s: Stats = stats ?? {
    revenue_paise: 0,
    upsell_paise: 0,
    upsell_pct: 0,
    orders_paid: 0,
    actions_guarded: 0,
    ledger_count: 0,
    ledger_intact: true,
    ledger_broken_at: null,
    head_hash: "",
    pending_approvals: 0,
    held_orders: 0,
  };

  const intact = s.ledger_intact;
  const integrityValue = intact ? "✓ Sahi hai" : `✗ Tampered at #${s.ledger_broken_at ?? "?"}`;

  return (
    <dl className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      <StatCard
        label="Revenue via AI"
        value={formatINR(s.revenue_paise)}
        caption={s.orders_paid === 1 ? "1 order paid" : `${s.orders_paid} orders paid`}
        valueClassName="text-money"
        loading={loading}
      />
      <StatCard
        label="Upsell uplift"
        value={formatINR(s.upsell_paise)}
        caption={`${s.upsell_pct}% of revenue from bundles`}
        loading={loading}
      />
      <StatCard label="Actions guarded" value={String(s.actions_guarded)} caption="COUNTER + GATE + DENY" captionClassName="font-mono tracking-wide" loading={loading} />
      <StatCard
        label="Ledger integrity"
        value={integrityValue}
        caption={`head ${shortHash(s.head_hash)} · ${s.ledger_count} entries`}
        valueClassName={cn("font-display text-2xl", intact ? "text-money" : "text-deny")}
        captionClassName="font-mono tnum"
        loading={loading}
      />
    </dl>
  );
}
