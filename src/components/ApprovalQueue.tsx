"use client";

import Link from "next/link";
import { useState } from "react";
import { ShieldCheck } from "@/components/illustrations";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { VerdictStamp } from "@/components/VerdictStamp";
import { ApiError, api, type OrderView } from "@/lib/demo/client";
import { useT } from "@/lib/i18n/core";
import { dashboard } from "@/lib/i18n/strings/dashboard";
import { formatINR } from "@/lib/money";

export interface ApprovalQueueProps {
  /** orders in PENDING_APPROVAL — the owner's call */
  pending: OrderView[];
  /** orders recovering from a failed payment (backup link live) or parked in HELD */
  held: OrderView[];
  /** false until the first poll has answered */
  loaded: boolean;
  /** called after a decision lands so the page can refresh right away */
  onChanged: () => void | Promise<void>;
}

type Decision = "approve" | "reject";

function OrderHeadline({ order }: { order: OrderView }) {
  const t = useT(dashboard);
  /* "₹5,648 Banarasi order": the first word of the first SKU names the card. */
  const lead = order.sku_names[0]?.trim().split(/\s+/)[0];
  return (
    <div className="min-w-0">
      <h3 className="font-display text-lg font-semibold leading-tight tracking-tight text-rzp-text">
        <span className="font-mono tnum">{formatINR(order.amount_paise)}</span> {lead ? t("order.title", { lead }) : t("order.title.plain")}
      </h3>
      <p className="mt-1 text-sm text-rzp-muted">
        {order.sku_names.join(" + ")}
        {order.qty > 1 ? ` × ${order.qty}` : ""}
      </p>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}

/**
 * The owner's desk: gated orders wait here for a human, and orders whose payment
 * failed at the bank sit below with their backup link. The AI never decides either.
 */
export function ApprovalQueue({ pending, held, loaded, onChanged }: ApprovalQueueProps) {
  const t = useT(dashboard);
  const { toast } = useToast();
  const [busy, setBusy] = useState<Record<string, Decision>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function decide(order: OrderView, decision: Decision) {
    setBusy((b) => ({ ...b, [order.id]: decision }));
    setErrors((e) => {
      const next = { ...e };
      delete next[order.id];
      return next;
    });
    try {
      await api.decide({ order_id: order.id, decision });
      toast(decision === "approve" ? t("queue.approved") : t("queue.rejected"), decision === "approve" ? "money" : "ink");
      await onChanged();
    } catch (err) {
      setErrors((e) => ({ ...e, [order.id]: err instanceof ApiError ? err.message : t("queue.error") }));
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[order.id];
        return next;
      });
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="approval-queue-heading">
        <Card aria-busy={!loaded || undefined}>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle id="approval-queue-heading">{t("queue.title")}</CardTitle>
              <CardDescription className="mt-0.5">{t("queue.desc")}</CardDescription>
            </div>
            {loaded && pending.length > 0 ? (
              <Badge tone="violet" dot className="shrink-0">
                {pending.length === 1 ? t("queue.waiting.one") : t("queue.waiting.many", { n: pending.length })}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {!loaded ? (
              <QueueSkeleton />
            ) : pending.length === 0 ? (
              <div className="flex items-center gap-4">
                <ShieldCheck className="w-20 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-rzp-text">{t("queue.empty.title")}</p>
                  <p className="mt-1 text-sm text-rzp-muted">
                    {t("queue.empty.desc")}{" "}
                    <Link href="/simulator" className="font-medium text-rzp-blueDeep underline-offset-4 hover:underline">
                      {t("queue.empty.cta")}
                    </Link>
                  </p>
                </div>
              </div>
            ) : (
              <ul className="space-y-3" aria-live="polite">
                {pending.map((order) => {
                  const working = busy[order.id];
                  return (
                    <li key={order.id} className="animate-write-in rounded-xl border border-rzp-violet/25 bg-rzp-violet/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <OrderHeadline order={order} />
                        <VerdictStamp kind="GATE" size="sm" animate={false} className="bg-white/80" />
                      </div>
                      <p className="mt-2 text-xs text-rzp-muted">{t("queue.note")}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="primary" onClick={() => void decide(order, "approve")} loading={working === "approve"} disabled={Boolean(working)}>
                          {t("queue.approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-outline"
                          onClick={() => void decide(order, "reject")}
                          loading={working === "reject"}
                          disabled={Boolean(working)}
                        >
                          {t("queue.reject")}
                        </Button>
                      </div>
                      {errors[order.id] ? (
                        <p className="mt-2 text-sm text-[#B3262C]" role="alert">
                          {errors[order.id]}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="held-orders-heading">
        <Card aria-busy={!loaded || undefined}>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle id="held-orders-heading">{t("held.title")}</CardTitle>
              <CardDescription className="mt-0.5">{t("held.desc")}</CardDescription>
            </div>
            {loaded && held.length > 0 ? (
              <Badge tone="amber" dot className="shrink-0">
                {held.length === 1 ? t("held.count.one") : t("held.count.many", { n: held.length })}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {!loaded ? (
              <Skeleton className="h-4 w-3/4" />
            ) : held.length === 0 ? (
              <p className="text-sm text-rzp-muted">{t("held.empty")}</p>
            ) : (
              <ul className="space-y-3" aria-live="polite">
                {held.map((order) => (
                  <li key={order.id} className="animate-write-in rounded-xl border border-rzp-amber/40 bg-rzp-amber/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <OrderHeadline order={order} />
                      <VerdictStamp kind="HELD" size="sm" animate={false} className="bg-white/80" />
                    </div>
                    <p className="mt-2 text-sm text-rzp-text">{order.payment_url ? t("held.linkReady") : t("held.linkComing")}</p>
                    {order.payment_url ? (
                      <a href={order.payment_url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary", size: "sm", className: "mt-3" })}>
                        {t("held.open")}
                        <span aria-hidden="true">↗</span>
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
