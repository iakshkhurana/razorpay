"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { api, type MetricsResponse } from "@/lib/demo/client";
import { useT } from "@/lib/i18n/core";
import { metrics as strings } from "@/lib/i18n/strings/metrics";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

const POLL_MS = 2000;

function ms(n: number | null | undefined): string {
  return typeof n === "number" ? `${n.toLocaleString("en-IN")} ms` : "—";
}

function timeOf(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** A tiny horizontal bar scaled against the slowest request on screen. */
function LatencyBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-full bg-rzp-mist2">
        <span className={cn("block h-full rounded-full", value > 8000 ? "bg-rzp-amber" : "bg-rzp-blue")} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs tnum">{ms(value)}</span>
    </span>
  );
}

export default function MetricsPage() {
  const t = useT(strings);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetNote, setResetNote] = useState<"done" | "error" | null>(null);
  const timer = useRef<number | null>(null);

  const deleteData = async () => {
    if (!window.confirm(t("danger.confirm"))) return;
    setResetting(true);
    setResetNote(null);
    try {
      const res = await fetch("/api/data/delete", { method: "POST" });
      if (!res.ok) throw new Error("reset failed");
      setResetNote("done");
    } catch {
      setResetNote("error");
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await api.metrics();
        if (!alive) return;
        setData(res);
        setError(false);
      } catch {
        if (alive) setError(true);
      }
    };
    void tick();
    timer.current = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, []);

  const s = data?.summary ?? null;
  const entries = data?.entries ?? [];
  const lastTurn = entries.find((e) => e.route === "negotiate") ?? null;
  const maxMs = Math.max(1, ...entries.map((e) => e.duration_ms));
  const loading = data === null && !error;

  return (
    <AppShell section="metrics" title={t("page.title")} subtitle={t("page.subtitle")}>
      <div className="space-y-6">
        {error ? (
          <p className="text-sm text-[#B3262C]" role="alert">
            {t("error")}
          </p>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={t("summary.turns")} value={s ? String(s.turns) : "—"} hint={t("summary.turnMs") + ": " + ms(s?.avg_turn_ms)} loading={loading} />
          <Stat label={t("summary.firstLlm")} value={ms(s?.avg_first_llm_ms)} hint={t("summary.tts") + ": " + ms(s?.avg_tts_ms)} loading={loading} />
          <Stat
            label={t("summary.tokens")}
            value={s ? `${s.total_prompt_tokens.toLocaleString("en-IN")} / ${s.total_completion_tokens.toLocaleString("en-IN")}` : "—"}
            loading={loading}
          />
          <Stat label={t("summary.cost")} value={s ? formatINR(s.est_cost_paise) : "—"} hint={t("summary.costHint")} tone="green" loading={loading} />
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("trace.title")}</CardTitle>
              <CardDescription>{t("trace.desc")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {lastTurn ? (
              <ol className="space-y-2">
                {lastTurn.llm_calls.map((c, i) => (
                  <li key={`llm-${i}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-rzp-border bg-rzp-mist/60 px-3 py-2 text-sm">
                    <span className="rounded-md bg-rzp-blue/10 px-2 py-0.5 font-mono text-xs font-bold text-rzp-blueDeep">{t("trace.llm")}</span>
                    <span className="font-mono text-xs">{c.model}</span>
                    <LatencyBar value={c.duration_ms} max={lastTurn.duration_ms} />
                    <span className="font-mono text-xs tnum text-rzp-muted">
                      {c.prompt_tokens} / {c.completion_tokens} tok
                    </span>
                  </li>
                ))}
                {lastTurn.tools.map((tool, i) => (
                  <li key={`tool-${i}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-rzp-border bg-white px-3 py-2 text-sm">
                    <span className="rounded-md bg-rzp-teal/10 px-2 py-0.5 font-mono text-xs font-bold text-rzp-teal">{t("trace.tool")}</span>
                    <span className="font-mono text-xs">{tool.name}</span>
                    <LatencyBar value={tool.duration_ms} max={lastTurn.duration_ms} />
                  </li>
                ))}
                <li className="px-3 pt-1 text-xs text-rzp-muted">
                  {t("col.latency")}: <span className="font-mono tnum">{ms(lastTurn.duration_ms)}</span> · {t("col.cost")}:{" "}
                  <span className="font-mono tnum">{formatINR(lastTurn.est_cost_paise)}</span>
                  {lastTurn.mode ? <span> · {lastTurn.mode}</span> : null}
                </li>
              </ol>
            ) : loading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-3/4" />
              </div>
            ) : (
              <p className="text-sm text-rzp-muted">{t("trace.none")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("table.title")}</CardTitle>
              <CardDescription>{t("table.desc")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className={cn(entries.length > 0 && "px-0 pb-2")}>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-rzp-muted">{t("empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-rzp-muted">
                      <th scope="col" className="px-5 pb-2 font-semibold">{t("col.when")}</th>
                      <th scope="col" className="pb-2 pr-3 font-semibold">{t("col.route")}</th>
                      <th scope="col" className="pb-2 pr-3 font-semibold">{t("col.latency")}</th>
                      <th scope="col" className="pb-2 pr-3 font-semibold">{t("col.llm")}</th>
                      <th scope="col" className="pb-2 pr-3 font-semibold">{t("col.tools")}</th>
                      <th scope="col" className="pb-2 pr-5 text-right font-semibold">{t("col.cost")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rzp-border">
                    {entries.map((e) => (
                      <tr key={e.id} className="transition-colors hover:bg-rzp-mist/60">
                        <td className="px-5 py-2 font-mono text-xs tnum text-rzp-muted">{timeOf(e.ts)}</td>
                        <td className="py-2 pr-3">
                          <span className={cn("rounded-md px-2 py-0.5 font-mono text-xs font-semibold", e.ok ? "bg-rzp-mist2 text-rzp-text" : "bg-rzp-red/10 text-[#B3262C]")}>
                            {e.route}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <LatencyBar value={e.duration_ms} max={maxMs} />
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs tnum text-rzp-muted">
                          {e.llm_calls.length > 0
                            ? `${e.llm_calls.reduce((a, c) => a + c.duration_ms, 0).toLocaleString("en-IN")} ms · ${e.llm_calls.reduce((a, c) => a + c.prompt_tokens + c.completion_tokens, 0)} tok`
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-rzp-muted">{e.tools.length > 0 ? e.tools.map((x) => x.name.replace(/^agentgate_/, "")).join(", ") : "—"}</td>
                        <td className="py-2 pr-5 text-right font-mono text-xs tnum">{e.est_cost_paise > 0 ? formatINR(e.est_cost_paise) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("danger.title")}</CardTitle>
              <CardDescription>{t("danger.desc")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void deleteData()} loading={resetting} disabled={resetting}>
              {t("danger.button")}
            </Button>
            {resetNote === "done" ? <p className="text-sm text-[#087443]">{t("danger.done")}</p> : null}
            {resetNote === "error" ? (
              <p className="text-sm text-[#B3262C]" role="alert">
                {t("danger.error")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <p className="text-xs text-rzp-muted">{t("note")}</p>
      </div>
    </AppShell>
  );
}
