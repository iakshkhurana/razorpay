"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="flex items-baseline gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/70">
      {children}
      {typeof count === "number" && count > 0 ? <span className="font-mono text-[11px] tracking-normal text-ink/70 tnum">{count}</span> : null}
    </h2>
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
      <section aria-labelledby="approval-queue-heading" className="space-y-3">
        <SectionLabel count={pending.length}>
          <span id="approval-queue-heading">Approval queue</span>
        </SectionLabel>

        {!loaded ? (
          <Card>
            <CardContent className="py-5 text-sm text-ink/70">Loading the queue…</CardContent>
          </Card>
        ) : pending.length === 0 ? (
          <Card>
            <CardContent className="py-5">
              <p className="text-sm font-medium">Koi order aapka intezaar nahi kar raha.</p>
              <p className="mt-1 text-sm text-ink/70">
                Orders above the gate land here for your call — the AI never approves them.{" "}
                <Link href="/simulator" className="text-action underline-offset-4 hover:underline">
                  Stage one in the simulator
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3" aria-live="polite">
            {pending.map((order) => {
              const working = busy[order.id];
              return (
                <li key={order.id}>
                  <Card className="animate-write-in">
                    <CardContent className="space-y-3 pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight">
                            <span className="font-mono tnum">{formatINR(order.amount_paise)}</span> {cardTitle(order)}
                          </h3>
                          <p className="mt-1 text-sm text-ink/70">
                            {order.sku_names.join(" + ")}
                            {order.qty > 1 ? ` × ${order.qty}` : ""}
                          </p>
                        </div>
                        <VerdictStamp kind="GATE" size="sm" animate={false} />
                      </div>
                      <p className="text-xs text-ink/70">Big order — you decide. Either answer is written into the book.</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void decide(order, "approve")}
                          loading={working === "approve"}
                          disabled={Boolean(working)}
                        >
                          Approve order
                        </Button>
                        <Button
                          size="sm"
                          variant="deny-outline"
                          onClick={() => void decide(order, "reject")}
                          loading={working === "reject"}
                          disabled={Boolean(working)}
                        >
                          Reject order
                        </Button>
                      </div>
                      {errors[order.id] ? (
                        <p className="text-sm text-deny" role="alert">
                          {errors[order.id]}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {held.length > 0 ? (
        <section aria-labelledby="held-orders-heading" className="space-y-3">
          <SectionLabel count={held.length}>
            <span id="held-orders-heading">Held orders</span>
          </SectionLabel>
          <ul className="space-y-3">
            {held.map((order) => (
              <li key={order.id}>
                <Card className="animate-write-in">
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg font-semibold leading-tight tracking-tight">
                          <span className="font-mono tnum">{formatINR(order.amount_paise)}</span> {cardTitle(order)}
                        </h3>
                        <p className="mt-1 text-sm text-ink/70">{order.sku_names.join(" + ")}</p>
                      </div>
                      <VerdictStamp kind="HELD" size="sm" animate={false} />
                    </div>
                    <p className="text-sm">
                      {order.payment_url
                        ? "Payment failed at the bank. A backup payment link is ready below."
                        : "Payment failed at the bank. A backup payment link is on its way — this card updates on its own."}
                    </p>
                    {order.payment_url ? (
                      <a
                        href={order.payment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center rounded-lg border border-action px-3 text-sm font-medium text-action hover:bg-action/5"
                      >
                        Open backup link
                      </a>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
