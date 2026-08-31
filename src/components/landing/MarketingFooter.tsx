import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { REPO_URL } from "./MarketingHeader";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

interface FooterColumn {
  title: string;
  links: readonly FooterLink[];
}

const COLUMNS: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Onboard a shop", href: "/onboard" },
      { label: "Buyer simulator", href: "/simulator" },
      { label: "Control Tower", href: "/dashboard" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Flows",
    links: [
      { label: "Happy path + upsell", href: "/simulator" },
      { label: "Bounded + gated", href: "/simulator" },
      { label: "Graceful failure", href: "/dashboard" },
      { label: "Grand Tour", href: "/?tour=1" },
    ],
  },
  {
    title: "Proof",
    links: [
      { label: "Scorecard", href: "/eval" },
      { label: "Red team: 40 attacks", href: "/eval" },
      { label: "Ledger integrity", href: "/dashboard" },
      { label: "Metrics", href: "/metrics" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Developers", href: "/developers" },
      { label: "GitHub", href: REPO_URL, external: true },
      { label: "README", href: `${REPO_URL}#readme`, external: true },
      { label: "MCP server", href: `${REPO_URL}/blob/HEAD/mcp/server.ts`, external: true },
    ],
  },
];

const LINK =
  "group inline-block rounded-sm text-sm text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-rzp-navy";

function FooterAnchor({ link }: { link: FooterLink }) {
  const inner = (
    <>
      <span className="bg-gradient-to-r from-rzp-cyan to-rzp-cyan bg-[length:0%_1px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-200 group-hover:bg-[length:100%_1px]">
        {link.label}
      </span>
      {link.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </>
  );
  if (link.external) {
    return (
      <a href={link.href} className={LINK} target="_blank" rel="noreferrer noopener">
        {inner}
      </a>
    );
  }
  return (
    <Link href={link.href} className={LINK}>
      {inner}
    </Link>
  );
}

/**
 * The dark closing act: gradient navy, a hairline of teal light on top, the
 * link columns, and the AgentGate watermark rising out of the darkness at
 * the very end of the page.
 */
export function MarketingFooter() {
  return (
    <footer className="relative overflow-hidden text-white" style={{ background: "linear-gradient(180deg, #0E2247 0%, #0B1D3A 34%, #060F22 100%)" }}>
      {/* hairline glow along the top edge */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(46,196,230,0.55), transparent)" }} />
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[42rem] -translate-x-1/2 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(47,107,255,0.22), transparent)" }} />

      <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
          <div className="max-w-sm">
            <BrandLogo variant="onDark" size={30} href={null} />
            <p className="mt-5 font-display text-2xl font-semibold tracking-tight">Har paisa, likha hua.</p>
            <p className="mt-2 text-sm leading-relaxed text-white/60">Every rupee your AI sells — explained, bounded, and written down.</p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
              <span className="h-1.5 w-1.5 rounded-full bg-rzp-green" aria-hidden="true" />
              Razorpay test rails · the LLM never touches money
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-labelledby={`footer-${col.title.toLowerCase()}`}>
              <h2 id={`footer-${col.title.toLowerCase()}`} className="text-xs font-semibold uppercase tracking-[0.16em] text-rzp-cyan/70">
                {col.title}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={`${col.title}-${link.label}`}>
                    <FooterAnchor link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-sm text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© AgentGate · built in India</p>
          <p>Test-mode rails only.</p>
        </div>
      </div>

      {/* the watermark rises out of the dark */}
      <div aria-hidden="true" className="relative select-none overflow-hidden px-2 pt-4">
        <p
          className="whitespace-nowrap text-center font-display font-bold uppercase leading-[0.78] tracking-tight text-transparent"
          style={{
            fontSize: "17.5vw",
            marginBottom: "-0.24em",
            backgroundImage: "linear-gradient(180deg, rgba(127,181,255,0.5) 0%, rgba(47,107,255,0.22) 45%, rgba(6,15,34,0) 92%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
          }}
        >
          AgentGate
        </p>
      </div>
    </footer>
  );
}
