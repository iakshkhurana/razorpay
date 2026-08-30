"use client";

import confetti from "canvas-confetti";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Avatar, TestModePill } from "@/components/AppShell";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VerdictStamp } from "@/components/VerdictStamp";
import { ApiError, api, type OrderView } from "@/lib/demo/client";
import { useT } from "@/lib/i18n/core";
import { mockpay, type MockPayKey } from "@/lib/i18n/strings/mockpay";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The mock bank's checkout. `PAYMENTS_MODE=mock` hands buyers a payment_url that
 * lands here; the two buttons post the same webhook the real rails would send.
 */

const DEFAULT_MERCHANT = "Ramesh Handlooms";

const CONFETTI_COLORS = ["#12B76A", "#2F6BFF", "#17A9CC", "#FF7A1A", "#FFFFFF"];

type Outcome = { kind: "idle" } | { kind: "posting"; result: "success" | "failure" } | { kind: "done"; status: string } | { kind: "error"; message: string };

const STATUS_KEY: Record<string, MockPayKey> = {
  AWAITING_PAYMENT: "status.AWAITING_PAYMENT",
  PENDING_APPROVAL: "status.PENDING_APPROVAL",
  PAID: "status.PAID",
  FAILED: "status.FAILED",
  HELD: "status.HELD",
  REJECTED: "status.REJECTED",
  DRAFT: "status.DRAFT",
};

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

function celebrate(): void {
  try {
    void confetti({
      particleCount: 80,
      spread: 64,
      startVelocity: 30,
      gravity: 0.9,
      ticks: 170,
      origin: { x: 0.5, y: 0.45 },
      colors: CONFETTI_COLORS,
    });
  } catch {
    /* no canvas (e.g. a hidden tab) — the stamp still lands */
  }
}

const LINK = "rounded font-medium text-rzp-blueDeep underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2";

function MockPay() {
  const t = useT(mockpay);
  const reduce = useReducedMotion();
  const params = useSearchParams();
  const orderId = params.get("order");
  const retry = params.get("retry");
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loadError, setLoadError] = useState<MockPayKey | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [merchant, setMerchant] = useState(DEFAULT_MERCHANT);
  const celebrated = useRef(false);

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      const { order: found } = await api.order(orderId);
      setOrder(found);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404 ? "error.notFound" : "error.unreachable");
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
      if (next.status === "PAID" && !celebrated.current && !reduce) {
        celebrated.current = true;
        celebrate();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("error.unreachable");
      setOutcome({ kind: "error", message });
    }
  }

  const posting = outcome.kind === "posting";
  const settled = outcome.kind === "done";
  const paid = order?.status === "PAID";
  const payable = Boolean(order) && !paid && order?.status !== "REJECTED";
  const amount = order ? formatINR(order.amount_paise) : null;
  const statusLabel = (status: string) => (STATUS_KEY[status] ? t(STATUS_KEY[status]) : status.toLowerCase().replace(/_/g, " "));

  return (
    <main className="bg-dots relative flex min-h-screen items-center justify-center bg-rzp-mist px-4 py-10 text-rzp-text">
      <div className="absolute right-4 top-4">
        <LanguageToggle size="compact" />
      </div>

      <motion.div
        className="w-full max-w-md"
        initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduce ? 0 : 0.45, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-rzp-muted">{t("page.eyebrow")}</p>

        <section aria-label={t("page.label")} className="overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-rzp-border">
          {/* header band — the checkout's navy top */}
          <div className="relative bg-rzp-navy px-6 pb-6 pt-5 text-white">
            <div aria-hidden="true" className="bg-arcs-light pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={merchant} />
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-semibold leading-tight">{merchant}</p>
                  <p className="text-xs text-white/70">{t("header.subtitle")}</p>
                </div>
              </div>
              <TestModePill />
            </div>
            <div className="relative mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">{t("header.amount")}</p>
                {amount ? (
                  <p className="mt-1 font-mono text-4xl font-semibold leading-none tnum">{amount}</p>
                ) : (
                  <Skeleton className="mt-2 h-9 w-32 bg-white/15" />
                )}
              </div>
              {retry ? (
                <span className="rounded-full border border-rzp-saffron/60 bg-rzp-saffron/20 px-2.5 py-1 text-xs font-medium text-orange-100">{t("header.retry", { n: retry })}</span>
              ) : null}
            </div>
            <p className="relative mt-4 flex items-center gap-1.5 text-[11px] text-white/60">
              <LockGlyph className="h-3 w-3" />
              {t("header.secured")}
            </p>
          </div>

          {/* body */}
          <div className="space-y-5 px-6 py-5">
            {!orderId ? (
              <p className="text-sm text-[#B3262C]" role="alert">
                {t("error.noOrder")}
              </p>
            ) : null}

            {loadError ? (
              <p className="text-sm text-[#B3262C]" role="alert">
                {t(loadError)}
              </p>
            ) : null}

            {order ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rzp-muted">{t("summary.title")}</p>
                <dl className="mt-1 divide-y divide-rzp-border text-sm">
                  <div className="flex items-start justify-between gap-4 py-2.5">
                    <dt className="text-rzp-muted">{t("summary.items")}</dt>
                    <dd className="text-right font-medium">
                      {order.sku_names.length > 0 ? (
                        <ul className="space-y-0.5">
                          {order.sku_names.map((name, i) => (
                            <li key={`${name}-${i}`}>
                              {name}
                              {order.qty > 1 ? <span className="font-mono text-xs text-rzp-muted tnum"> ×{order.qty}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        t("summary.none")
                      )}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-rzp-muted">{t("summary.order")}</dt>
                    <dd className="font-mono text-xs tnum text-rzp-text" title={order.id}>
                      {shortId(order.id)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <dt className="text-rzp-muted">{t("summary.status")}</dt>
                    <dd className="flex items-center gap-2">
                      <span className="text-xs text-rzp-muted">{statusLabel(order.status)}</span>
                      <VerdictStamp kind={stampFor(order.status)} size="sm" animate={settled} />
                    </dd>
                  </div>
                  {order.attempts > 1 ? (
                    <div className="flex items-baseline justify-between gap-4 py-2.5">
                      <dt className="text-rzp-muted">{t("summary.attempts")}</dt>
                      <dd className="font-mono text-xs tnum">{order.attempts}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="font-medium text-rzp-text">{t("summary.total")}</dt>
                    <dd className="font-mono text-base font-semibold tnum text-rzp-text">{amount}</dd>
                  </div>
                </dl>
              </div>
            ) : orderId && !loadError ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <p className="text-sm text-rzp-muted">{t("loading.order")}</p>
              </div>
            ) : null}

            {order && payable ? (
              <div className="grid gap-3">
                <Button size="lg" variant="payment" className="w-full" onClick={() => simulate("success")} loading={posting && outcome.result === "success"} disabled={posting}>
                  {posting && outcome.result === "success" ? t("btn.paying") : t("btn.pay", { amount: amount ?? "" })}
                </Button>
                <Button size="lg" variant="danger-outline" className="w-full" onClick={() => simulate("failure")} loading={posting && outcome.result === "failure"} disabled={posting}>
                  {posting && outcome.result === "failure" ? t("btn.failing") : t("btn.fail")}
                </Button>
                <p className="text-center text-xs text-rzp-muted">{t("footer.webhook")}</p>
              </div>
            ) : null}

            <div aria-live="polite" className="space-y-3">
              {outcome.kind === "error" ? (
                <p className="text-sm text-[#B3262C]" role="alert">
                  {outcome.message}
                </p>
              ) : null}

              <AnimatePresence initial={false}>
                {settled && paid ? (
                  <motion.div
                    key="paid"
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3 }}
                    className="flex items-start gap-3 rounded-xl border border-rzp-green/30 bg-rzp-green/10 px-4 py-3"
                  >
                    <VerdictStamp kind="PAID" size="lg" animate />
                    <div>
                      <p className="text-sm font-medium text-[#087443]">{t("result.paid")}</p>
                      <p className="mt-0.5 text-xs text-rzp-muted">{t("result.paidSub")}</p>
                    </div>
                  </motion.div>
                ) : null}

                {settled && !paid && order?.held_recovering ? (
                  <motion.div
                    key="held"
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.3 }}
                    className="flex items-start gap-3 rounded-xl border border-rzp-amber/40 bg-rzp-amber/10 px-4 py-3"
                  >
                    <VerdictStamp kind="HELD" size="lg" animate />
                    <div>
                      <p className="text-sm font-medium text-[#9A4F00]">{t("result.held")}</p>
                      <p className="mt-0.5 text-xs text-rzp-muted">{t("result.heldSub")}</p>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {settled && !paid && !order?.held_recovering && order ? (
                <p className="text-sm text-rzp-muted">{t("result.other", { status: statusLabel(order.status) })}</p>
              ) : null}

              {!settled && order && !payable ? <p className="text-sm text-rzp-muted">{paid ? t("result.alreadyPaid") : t("result.rejected")}</p> : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rzp-border pt-4 text-sm">
              <Link href="/simulator" className={cn(LINK)}>
                {t("link.simulator")}
              </Link>
              <Link href="/dashboard" className={cn(LINK)}>
                {t("link.tower")}
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 border-t border-rzp-border bg-rzp-mist px-6 py-3 text-xs text-rzp-muted">
            <LockGlyph className="h-3.5 w-3.5" />
            <span>{t("footer.rails")}</span>
          </div>
        </section>
      </motion.div>
    </main>
  );
}

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function PageFallback() {
  const t = useT(mockpay);
  return (
    <main className="flex min-h-screen items-center justify-center bg-rzp-mist px-4 py-10 text-sm text-rzp-muted">
      <p>{t("loading.page")}</p>
    </main>
  );
}

export default function MockPayPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <MockPay />
    </Suspense>
  );
}
