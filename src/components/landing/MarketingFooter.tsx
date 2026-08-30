import Link from "next/link";
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
      { label: "Evidence", href: "/eval" },
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
      { label: "Results table", href: `${REPO_URL}#readme`, external: true },
    ],
  },
  {
    title: "Repo",
    links: [
      { label: "GitHub", href: REPO_URL, external: true },
      { label: "README", href: `${REPO_URL}#readme`, external: true },
      { label: "MCP server", href: `${REPO_URL}/blob/HEAD/mcp/server.ts`, external: true },
      { label: "Issues", href: `${REPO_URL}/issues`, external: true },
    ],
  },
];

const LINK =
  "inline-block rounded-sm text-sm text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 focus-visible:ring-offset-rzp-navy";

function FooterAnchor({ link }: { link: FooterLink }) {
  if (link.external) {
    return (
      <a href={link.href} className={LINK} target="_blank" rel="noreferrer noopener">
        {link.label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={link.href} className={LINK}>
      {link.label}
    </Link>
  );
}

export function MarketingFooter() {
  return (
    <footer className="bg-rzp-navy text-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
          <div className="max-w-sm">
            <p className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="6" fill="#3395FF" />
                <path d="M7 16.5 12 6l5 10.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.2 13h5.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
              AgentGate
            </p>
            <p className="mt-4 font-display text-2xl font-semibold tracking-tight">Har paisa, likha hua.</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">Every rupee your AI sells — explained, bounded, and written down.</p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-labelledby={`footer-${col.title.toLowerCase()}`}>
              <h2 id={`footer-${col.title.toLowerCase()}`} className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
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

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p>Built for Razorpay Hackathon · Track 01</p>
          <p>Test-mode rails only. The LLM never touches money.</p>
        </div>
      </div>
    </footer>
  );
}
