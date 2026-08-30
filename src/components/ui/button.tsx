import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Button variants.
 *
 * Current set: primary · secondary · ghost · outline-blue · danger-outline · payment (alias of primary).
 * Legacy names (outline · money · deny-outline · subtle) still resolve so older screens keep working.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline-blue"
  | "danger-outline"
  | "payment"
  /* legacy aliases */
  | "outline"
  | "money"
  | "deny-outline"
  | "subtle";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-rzp-blue bg-rzp-blue text-white shadow-sm hover:border-rzp-blueHover hover:bg-rzp-blueHover hover:shadow-glow active:bg-rzp-blueDeep",
  payment: "border border-rzp-blue bg-rzp-blue text-white shadow-sm hover:border-rzp-blueHover hover:bg-rzp-blueHover hover:shadow-glow active:bg-rzp-blueDeep",
  secondary: "border border-rzp-border bg-white text-rzp-text shadow-sm hover:border-[#C9D6EC] hover:bg-rzp-mist active:bg-rzp-mist2",
  ghost: "border border-transparent bg-transparent text-rzp-blueDeep hover:bg-rzp-blue/10 active:bg-rzp-blue/15",
  "outline-blue": "border border-rzp-blue bg-white text-rzp-blueDeep hover:bg-rzp-blue/10 active:bg-rzp-blue/15",
  "danger-outline": "border border-rzp-red bg-white text-[#B3262C] hover:bg-rzp-red/10 active:bg-rzp-red/15",
  /* legacy aliases */
  outline: "border border-rzp-border bg-white text-rzp-text shadow-sm hover:border-[#C9D6EC] hover:bg-rzp-mist active:bg-rzp-mist2",
  money: "border border-rzp-green bg-rzp-green text-white shadow-sm hover:bg-[#0FA65F] hover:shadow-[0_8px_24px_rgba(18,183,106,0.35)] active:bg-[#0C8F52]",
  "deny-outline": "border border-rzp-red bg-white text-[#B3262C] hover:bg-rzp-red/10 active:bg-rzp-red/15",
  subtle: "border border-transparent bg-rzp-mist2 text-rzp-text hover:bg-[#E3EDFF] active:bg-[#D8E5FF]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 rounded-lg px-3 text-sm",
  md: "h-10 rounded-xl px-4 text-sm",
  lg: "h-12 rounded-xl px-6 text-base",
};

/** Class string for a button look without the element — use on <Link> or <a>. */
export function buttonClasses(opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  const { variant = "primary", size = "md", className } = opts;
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, disabled, children, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
