"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV: Array<{ href: string; label: string }> = [
  { href: "/onboard", label: "Onboard" },
  { href: "/simulator", label: "Simulator" },
  { href: "/dashboard", label: "Control Tower" },
  { href: "/eval", label: "Evidence" },
];

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="border-t-[6px] border-spine">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          AgentGate
        </Link>
        <nav className="flex items-center gap-1" aria-label="Primary">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-ink/5 text-ink" : "text-ink/70 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          {right ? <div className="ml-3 flex items-center gap-2">{right}</div> : null}
        </nav>
      </div>
    </header>
  );
}
