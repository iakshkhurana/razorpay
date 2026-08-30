"use client";

import { usePathname } from "next/navigation";
import * as React from "react";
import { Spinner } from "@/components/ui/button";
import { useT } from "@/lib/i18n/core";
import { common } from "@/lib/i18n/strings/common";
import { nav } from "@/lib/i18n/strings/nav";
import { cn } from "@/lib/utils";

/**
 * Thin saffron→blue→cyan bar at the very top of the viewport.
 *
 * It starts the moment a same-origin link is clicked (capture phase, before
 * the router takes over), completes when the pathname changes, and fades out.
 * Navigations that skip a click (back button, router.push) still get the
 * completion flash. Nothing renders on the first paint, so hydration is clean.
 */

type ProgressState = "idle" | "running" | "done";

const SAFETY_MS = 8000;
const DONE_MS = 480;

function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/** The anchor's target when it is an in-app navigation, otherwise null. */
function navigationTarget(anchor: HTMLAnchorElement): URL | null {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
  return url;
}

export function RouteProgress() {
  const pathname = usePathname();
  const [state, setState] = React.useState<ProgressState>("idle");
  const firstRender = React.useRef(true);
  const timer = React.useRef<number | null>(null);
  const t = useT(nav);

  const arm = React.useCallback((next: ProgressState, ms: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setState(next);
    }, ms);
  }, []);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!isPlainLeftClick(e)) return;
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !navigationTarget(anchor)) return;
      setState("running");
      arm("idle", SAFETY_MS);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [arm]);

  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setState("done");
    arm("idle", DONE_MS);
  }, [pathname, arm]);

  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (state === "idle") return null;
  return <div className="route-progress" data-state={state} role="progressbar" aria-label={t("progress.label")} aria-valuetext={state === "done" ? "100%" : undefined} />;
}

/** Centered blue spinner + "Loading…" on mist — the body of app/loading.tsx. */
export function LoadingState({ className, fullScreen = true }: { className?: string; fullScreen?: boolean }) {
  const t = useT(common);
  return (
    <div className={cn("flex items-center justify-center bg-rzp-mist text-rzp-text", fullScreen ? "min-h-screen" : "min-h-[40vh]", className)} role="status" aria-live="polite">
      <div className="fade-up flex flex-col items-center gap-3">
        <Spinner className="h-9 w-9 text-rzp-blue" />
        <p className="text-sm font-medium text-rzp-muted">{t("status.loading")}</p>
      </div>
    </div>
  );
}
