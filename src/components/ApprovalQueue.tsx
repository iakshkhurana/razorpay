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

/** "₹5,648 Banarasi order": the first word of the first SKU names the card; a nameless order is just "₹5,648 order". */
function cardTitle(order: OrderView): string {
  const lead = order.sku_names[0]?.trim().split(/\s+/)[0];
  return lead ? `${lead} order` : "order";
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Could not reach the shop. Check that the app is running and try again.";
}

function OrderHeadline({ order }: { order: OrderView }) {
  return (
    <div className="min-w-0">
      <h3 className="font-display text-lg font-semibold leading-tight tracking-tight text-rzp-text">
        <span className="font-mono tnum">{formatINR(order.amount_paise)}</span> {cardTitle(order)}
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
      toast(decision === "approve" ? "Order approved — payment link bhej diya" : "Order rejected — ledger mein likh diya", decision === "approve" ? "money" : "ink");
      await onChanged();
    } catch (err) {
      setErrors((e) => ({ ...e, [order.id]: describeError(err) }));
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
              <CardTitle id="approval-queue-heading">Owner&apos;s call</CardTitle>
              <CardDescription className="mt-0.5">Orders above the gate wait for you. The AI never decides these.</CardDescription>
            </div>
            {loaded && pending.length > 0 ? (
              <Badge tone="violet" dot className="shrink-0">
                {pending.length} waiting
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
                  <p className="text-sm font-medium text-rzp-text">Koi order aapka intezaar nahi kar raha.</p>
                  <p className="mt-1 text-sm text-rzp-muted">
                    Big orders land here for your call.{" "}
                    <Link href="/simulator" className="font-medium text-rzp-blueDeep underline-offset-4 hover:underline">
                      Stage one in the simulator
                    </Link>
                    .
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
                      <p className="mt-2 text-xs text-rzp-muted">Big order — you decide. Either answer is written into the book.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="primary" onClick={() => void decide(order, "approve")} loading={working === "approve"} disabled={Boolean(working)}>
                          Approve order
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-outline"
                          onClick={() => void decide(order, "reject")}
                          loading={working === "reject"}
                          disabled={Boolean(working)}
                        >
                          Reject order
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
              <CardTitle id="held-orders-heading">Held &amp; recovering</CardTitle>
              <CardDescription className="mt-0.5">When the bank fails a payment, the order parks here with a backup link.</CardDescription>
            </div>
            {loaded && held.length > 0 ? (
              <Badge tone="amber" dot className="shrink-0">
                {held.length} held
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {!loaded ? (
              <Skeleton className="h-4 w-3/4" />
            ) : held.length === 0 ? (
              <p className="text-sm text-rzp-muted">Koi payment atki nahi hai. Nothing is lost when one fails — it recovers from here.</p>
            ) : (
              <ul className="space-y-3" aria-live="polite">
                {held.map((order) => (
                  <li key={order.id} className="animate-write-in rounded-xl border border-rzp-amber/40 bg-rzp-amber/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <OrderHeadline order={order} />
                      <VerdictStamp kind="HELD" size="sm" animate={false} className="bg-white/80" />
                    </div>
                    <p className="mt-2 text-sm text-rzp-text">
                      {order.payment_url
                        ? "Payment failed at the bank. A backup payment link is ready below."
                        : "Payment failed at the bank. A backup payment link is on its way — this card updates on its own."}
                    </p>
                    {order.payment_url ? (
                      <a href={order.payment_url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "outline-blue", size: "sm", className: "mt-3" })}>
                        Open backup link
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
