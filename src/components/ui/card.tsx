import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** deeper shadow — for the one card on a page that should read as raised */
  elevated?: boolean;
  /** frosted white on top of a gradient (.glass) */
  glass?: boolean;
  /** "ledger": maroon cloth spine + ruled paper — the bahi-khata surface */
  surface?: "ledger";
  /** lifts on hover; use on cards that are links or open something */
  interactive?: boolean;
}

/**
 * White rounded-2xl card with a soft layered shadow. `glass` swaps the fill for a
 * frosted pane, `surface="ledger"` keeps the account-book look (spine + ruled lines).
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, elevated = false, glass = false, surface, interactive = false, ...props },
  ref,
) {
  const ledger = surface === "ledger";
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl",
        glass ? "glass" : "border border-rzp-border bg-white",
        elevated ? "shadow-lift" : "shadow-card",
        ledger && "ledger-spine ruled-paper overflow-hidden pl-[6px]",
        interactive && "card-lift",
        className,
      )}
      {...props}
    />
  );
});

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-lg font-semibold tracking-tight text-rzp-text", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-rzp-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5 pt-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-3 px-5 pb-5", className)} {...props} />;
}
