import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder. Size it with className (h-4 w-32, h-10 w-full …).
 * Decorative only — wrap the real region in aria-busy while it shows.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-rzp-mist2", className)} {...props} />;
}

/** A few stacked text-line skeletons. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
