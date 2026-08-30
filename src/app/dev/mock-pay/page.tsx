"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VerdictStamp } from "@/components/VerdictStamp";
import { formatINR } from "@/lib/money";

interface OrderView {
  id: string;
  amount_paise: number;
  status: string;
  sku_names: string[];
  attempts: number;
  held_recovering: boolean;
}

type Outcome = { kind: "idle" } | { kind: "posting" } | { kind: "done"; status: string } | { kind: "error"; message: string };

function MockPay() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const retry = params.get("retry");
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetch(`/api/orders?id=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      if (!res.ok) {
        setLoadError("This payment link does not match an order. Go back to the simulator and try again.");
        return;
      }
      const data = (await res.json()) as { order: OrderView };
      setOrder(data.order);
    } catch {
      setLoadError("Could not reach the shop. Check that the app is running.");
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function simulate(result: "success" | "failure") {
    if (!orderId) return;
    setOutcome({ kind: "posting" });
    try {
      const res = await fetch("/api/dev/simulate-webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, outcome: result }),
      });
      const data = (await res.json()) as { ok: boolean; order?: OrderView; error?: string };
      if (!res.ok || !data.order) {
        setOutcome({ kind: "error", message: data.error ?? "The bank did not respond. Try again." });
        return;
      }
      setOrder(data.order);
      setOutcome({ kind: "done", status: data.order.status });
    } catch {
      setOutcome({ kind: "error", message: "Could not reach the shop. Check that the app is running." });
    }
  }

  const settled = outcome.kind === "done";
  const paid = order?.status === "PAID";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-ink/70">Test bank Â· mock rails</p>
      <Card className="ledger-spine ruled-paper pl-4">
        <CardContent className="space-y-5">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Payment request</h1>
            <p className="mt-1 text-sm text-ink/70">
              {retry ? `Backup link Â· attempt ${retry}` : "Pay this order on the test rails. Nothing real moves."}
            </p>
          </div>

          {loadError ? <p className="text-sm text-deny">{loadError}</p> : null}

          {order ? (
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink/70">Order</dt>
                <dd className="font-mono text-xs tnum">{order.id}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink/70">Items</dt>
                <dd className="text-right">{order.sku_names.join(" + ")}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-ink/10 pt-3">
                <dt className="font-medium">Amount</dt>
                <dd className="font-mono text-2xl font-semibold tnum text-money">{formatINR(order.amount_paise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink/70">Status</dt>
                <dd>
                  <VerdictStamp kind={stampFor(order.status)} size="sm" animate={settled} />
                </dd>
              </div>
            </dl>
          ) : !loadError ? (
            <p className="text-sm text-ink/70">Loading the orderâ€¦</p>
          ) : null}

          {order && !paid && order.status !== "REJECTED" ? (
            <div className="grid gap-3 pt-2">
              <Button size="lg" variant="money" onClick={() => simulate("success")} loading={outcome.kind === "posting"} disabled={outcome.kind === "posting"}>
                Pay {formatINR(order.amount_paise)} â€” Success
              </Button>
              <Button size="lg" variant="deny-outline" onClick={() => simulate("failure")} disabled={outcome.kind === "posting"}>
                Simulate Failure
              </Button>
            </div>
          ) : null}

          {outcome.kind === "error" ? <p className="text-sm text-deny">{outcome.message}</p> : null}

          {settled && paid ? (
            <p className="text-sm text-money">Paid. The book already has the entry â€” see it in the Control Tower.</p>
          ) : null}
          {settled && !paid && order?.held_recovering ? (
            <p className="text-sm text-turmeric">
              Payment failed at the bank. The order is held and a backup payment link is ready â€” this page is that link. Pay again when ready.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3 pt-2 text-sm">
            <Link href="/simulator" className="text-action underline-offset-4 hover:underline">
              Back to simulator
            </Link>
            <Link href="/dashboard" className="text-action underline-offset-4 hover:underline">
              Open Control Tower
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
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

export default function MockPayPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-6 py-12 text-sm text-ink/70">Loadingâ€¦</main>}>
      <MockPay />
    </Suspense>
  );
}
