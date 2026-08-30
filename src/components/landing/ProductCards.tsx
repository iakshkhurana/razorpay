import Link from "next/link";
import type { ComponentType } from "react";
import { ChatVerdict, LedgerStamp, ShieldCheck, Storefront, type IllustrationProps } from "@/components/illustrations";
import { cn } from "@/lib/utils";

interface ProductCard {
  href: string;
  title: string;
  line: string;
  cta: string;
  Art: ComponentType<IllustrationProps>;
  /** gradient panel behind the illustration */
  panel: string;
}

const CARDS: readonly ProductCard[] = [
  {
    href: "/onboard",
    title: "Onboard a shop",
    line: "Paste a catalog URL or CSV — ya rules bol do in Hinglish. AI drafts the rulebook; the shopkeeper approves it.",
    cta: "Start onboarding",
    Art: Storefront,
    panel: "from-[#EEF4FF] to-[#DCEBFF]",
  },
  {
    href: "/simulator",
    title: "Buyer simulator",
    line: "Watch an AI buyer negotiate under a signed mandate, with every offer stamped the moment policy speaks.",
    cta: "Run a demo buyer",
    Art: ChatVerdict,
    panel: "from-[#EEF4FF] to-[#D6E6FF]",
  },
  {
    href: "/dashboard",
    title: "Control Tower",
    line: "The living ledger, rupee stats, approvals and held orders — in shopkeeper words or raw JSON.",
    cta: "Open Control Tower",
    Art: LedgerStamp,
    panel: "from-[#F4F8FF] to-[#DCEBFF]",
  },
  {
    href: "/eval",
    title: "Evidence",
    line: "100 seeded sessions, 40 red-team attacks, 0 breaches. Measured, not vibes.",
    cta: "See the scorecard",
    Art: ShieldCheck,
    panel: "from-[#ECFDF3] to-[#DCEBFF]",
  },
];

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
    </svg>
  );
}

/** Four illustrated entry points into the product, docs-style. */
export function ProductCards() {
  return (
    <section id="product" aria-labelledby="product-heading" className="scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rzp-blueDeep">Product</p>
          <h2 id="product-heading" className="mt-2 font-display text-3xl font-bold tracking-tight text-rzp-navy sm:text-4xl">
            One shop, four doors.
          </h2>
          <p className="mt-3 text-base text-rzp-muted sm:text-lg">
            Onboard, let agents trade, watch the book, and check the proof. Each screen is a real surface of the same product — nothing staged.
          </p>
        </div>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {CARDS.map((card) => (
            <li key={card.href}>
              <Link
                href={card.href}
                className={cn(
                  "group card-lift flex h-full flex-col overflow-hidden rounded-2xl border border-rzp-border bg-white shadow-card",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2",
                )}
              >
                <div className={cn("bg-dots relative flex items-center justify-center bg-gradient-to-br px-6 pb-2 pt-6", card.panel)}>
                  <card.Art className="w-44 max-w-full" />
                </div>
                <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
                  <h3 className="font-display text-lg font-semibold tracking-tight text-rzp-text">{card.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-rzp-muted">{card.line}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-rzp-blueDeep">
                    {card.cta}
                    <Arrow />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
