"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { MarketingNav } from "@/components/MarketingNav";
import { cn } from "@/lib/utils";

export const REPO_URL = "https://github.com/iakshkhurana/razorpay";

/** Brand chip linking home — kept for screens that imported the old wordmark. */
export function WordMark({ className }: { className?: string }) {
  return <BrandLogo variant="chip" size={36} className={cn("shrink-0", className)} />;
}

/** The marketing header is the shared MarketingNav (notch tab, mega panels, drawer). */
export function MarketingHeader() {
  return <MarketingNav />;
}

/** Small text link used by older landing sections. */
export function HeaderLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("text-sm font-medium text-rzp-navy/80 hover:text-rzp-navy", className)}>
      {children}
    </Link>
  );
}
