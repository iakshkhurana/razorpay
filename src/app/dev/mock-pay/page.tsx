"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Avatar, TestModePill } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VerdictStamp } from "@/components/VerdictStamp";
import { ApiError, api, type OrderView } from "@/lib/demo/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The mock bank's checkout. `PAYMENTS_MODE=mock` hands buyers a payment_url that
 * lands here; the two buttons post the same webhook the real rails would send.
 */

const DEFAULT_MERCHANT = "Ramesh Handlooms";

type Outcome = { kind: "idle" } | { kind: "posting"; result: "success" | "failure" } | { kind: "done"; status: string } | { kind: "error"; message: string };

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

function stampFor(status: string): string {
  switch (status) {
    case "PAID":
      return "PAID";
    case "FAILED":
      return "FAILED";
    case "HELD":
      return "HELD";
    case "PENDING_APPROVAL":
      return "GATE";
    case "REJECTED":
      return "DENY";
    default:
      return "ALLOW";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "AWAITING_PAYMENT":
      return "Awaiting payment";
    case "PENDING_APPROVAL":
      return "Waiting for the owner";
    case "PAID":
      return "Paid";
    case "FAILED":
      return "Failed at the bank";
    case "HELD":
      return "Held · backup link";
    case "REJECTED":
      return "Rejected by the owner";
    default:
      return status.toLowerCase().replace(/_/g, " ");
  }
}

function MockPay() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const retry = params.get("retry");
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [merchant, setMerchant] = useState(DEFAULT_MERCHANT);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      const { order: found } = await api.order(orderId);
      setOrder(found);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setLoadError("This payment link does not match an order. Go back to the simulator and try again.");
      } else {
        setLoadError("Could not reach the shop. Check that the app is running.");
      }
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The shop's name for the header band; the seed merchant until the server answers. */
  useEffect(() => {
    let cancelled = false;
    api
      .stats()
      .then((s) => {
        if (!cancelled && s.merchant?.name) setMerchant(s.merchant.name);
      })
      .catch(() => {
        /* the default name stands */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function simulate(result: "success" | "failure") {
    if (!orderId) return;
    setOutcome({ kind: "posting", result });
    try {
      const { order: next } = await api.simulateWebhook({ order_id: orderId, outcome: result });
      setOrder(next);
      setOutcome({ kind: "done", status: next.status });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not reach the shop. Check that the app is running.";
      setOutcome({ kind: "error", message });
    }
  }

  const posting = outcome.kind === "posting";
  const settled = outcome.kind === "done";
  const paid = order?.status === "PAID";
  const payable = Boolean(order) && !paid && order?.status !== "REJECTED";
  const amount = order ? formatINR(order.amount_paise) : null;

  return (
    <main className="bg-dots flex min-h-screen items-center justify-center bg-rzp-mist px-4 py-10 text-rzp-text">
      <div className="fade-up w-full max-w-md">
        <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-rzp-muted">Test bank · mock rails</p>

        <section aria-label="Payment request" className="overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-rzp-border">
          {/* header band */}
          <div className="bg-rzp-navy px-6 pb-6 pt-5 text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={merchant} />
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-semibold leading-tight">{merchant}</p>
                  <p className="text-xs text-white/70">Test checkout</p>
                </div>
              </div>
              <TestModePill />
            </div>
            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">Amount</p>
                {amount ? (
                  <p className="mt-1 font-mono text-4xl font-semibold leading-none tnum">{amount}</p>
                ) : (
                  <Skeleton className="mt-2 h-9 w-32 bg-white/15" />
                )}
              </div>
              {retry ? (
                <span className="rounded-full border border-rzp-amber/50 bg-rzp-amber/15 px-2.5 py-1 text-xs font-medium text-amber-100">
                  Backup link · attempt {retry}
                </span>
              ) : null}
            </div>
          </div>

          {/* body */}
          <div className="space-y-5 px-6 py-5">
            {!orderId ? (
              <p className="text-sm text-[#B3262C]" role="alert">
                This payment link carries no order. Open it from the simulator&apos;s payment link or the Control Tower&apos;s held order.
              </p>
            ) : null}

            {loadError ? (
              <p className="text-sm text-[#B3262C]" role="alert">
                {loadError}
              </p>
            ) : null}

            {order ? (
              <dl className="divide-y divide-rzp-border text-sm">
                <div className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-rzp-muted">Items</dt>
                  <dd className="text-right font-medium">{order.sku_names.length > 0 ? order.sku_names.join(" + ") : "—"}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-rzp-muted">Order</dt>
                  <dd className="font-mono text-xs tnum text-rzp-text" title={order.id}>
                    {shortId(order.id)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-rzp-muted">Status</dt>
                  <dd className="flex items-center gap-2">
                    <span className="text-xs text-rzp-muted">{statusLabel(order.status)}</span>
                    <VerdictStamp kind={stampFor(order.status)} size="sm" animate={settled} />
                  </dd>
                </div>
                {order.attempts > 1 ? (
                  <div className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-rzp-muted">Attempts</dt>
                    <dd className="font-mono text-xs tnum">{order.attempts}</dd>
                  </div>
                ) : null}
              </dl>
            ) : orderId && !loadError ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <p className="text-sm text-rzp-muted">Loading the order…</p>
              </div>
            ) : null}

            {order && payable ? (
              <div className="grid gap-3">
                <Button
                  size="lg"
                  variant="payment"
                  className="w-full"
                  onClick={() => simulate("success")}
                  loading={posting && outcome.result === "success"}
                  disabled={posting}
                >
                  Pay {amount} — Success
                </Button>
                <Button
                  size="lg"
                  variant="danger-outline"
                  className="w-full"
                  onClick={() => simulate("failure")}
                  loading={posting && outcome.result === "failure"}
                  disabled={posting}
                >
                  Simulate Failure
                </Button>
              </div>
            ) : null}

            <div aria-live="polite" className="space-y-3">
              {outcome.kind === "error" ? (
                <p className="text-sm text-[#B3262C]" role="alert">
                  {outcome.message}
                </p>
              ) : null}

              {settled && paid ? (
                <div className="flex items-center gap-3 rounded-xl border border-rzp-green/30 bg-rzp-green/10 px-4 py-3">
                  <VerdictStamp kind="PAID" size="lg" animate />
                  <p className="text-sm font-medium text-[#087443]">Paid — the book already has the entry.</p>
                </div>
              ) : null}

              {settled && !paid && order?.held_recovering ? (
                <p className="rounded-xl border border-rzp-amber/40 bg-rzp-amber/10 px-4 py-3 text-sm text-[#9A4F00]">
                  Payment failed at the bank. This page is the backup link — pay again when ready.
                </p>
              ) : null}

              {settled && !paid && !order?.held_recovering && order ? (
                <p className="text-sm text-rzp-muted">
                  The order is now <span className="font-medium text-rzp-text">{statusLabel(order.status)}</span>. The ledger has the entry.
                </p>
              ) : null}

              {!settled && order && !payable ? (
                <p className="text-sm text-rzp-muted">
                  {paid ? "This order is already paid — nothing more to do here." : "This order was rejected by the owner, so the bank will not take a payment."}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rzp-border pt-4 text-sm">
              <Link href="/simulator" className={cn("rounded font-medium text-rzp-blueDeep underline-offset-4 hover:underline", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2")}>
                Back to simulator
              </Link>
              <Link
                href="/dashboard"
                className={cn("rounded font-medium text-rzp-blueDeep underline-offset-4 hover:underline", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2")}
              >
                Open Control Tower
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 border-t border-rzp-border bg-rzp-mist px-6 py-3 text-xs text-rzp-muted">
            <LockGlyph />
            <span>Test rails · no real money moves</span>
          </div>
        </section>
      </div>
    </main>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export default function MockPayPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-rzp-mist px-4 py-10 text-sm text-rzp-muted">
          <p>Loading…</p>
        </main>
      }
    >
      <MockPay />
    </Suspense>
  );
}
