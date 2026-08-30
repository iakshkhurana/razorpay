import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Small step illustrations (original inline SVG, 64×64)              */
/* ------------------------------------------------------------------ */

function RulebookGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14" fill="none" aria-hidden="true">
      <rect x="12" y="8" width="40" height="48" rx="8" fill="#FFFFFF" stroke="#1E3A6E" strokeWidth="1.5" />
      <rect x="22" y="4" width="20" height="8" rx="4" fill="#3395FF" />
      {[24, 34, 44].map((y, i) => (
        <g key={y}>
          <rect x="19" y={y - 1.5} width="26" height="3" rx="1.5" fill="#DCEBFF" />
          <rect x="19" y={y - 1.5} width={[16, 22, 10][i]} height="3" rx="1.5" fill="#79B5FF" />
          <circle cx={19 + [16, 22, 10][i]} cy={y} r="3.5" fill="#FFFFFF" stroke="#1E5FBF" strokeWidth="1.5" />
        </g>
      ))}
      <circle cx="50" cy="50" r="8" fill="#12B76A" />
      <path d="m46.5 50 2.5 2.5 4.5-5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NegotiateGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14" fill="none" aria-hidden="true">
      <path d="M8 14a6 6 0 0 1 6-6h22a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H20l-8 6v-6h-2a6 6 0 0 1-6-6z" fill="#FFFFFF" stroke="#1E3A6E" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="12" y="14" width="18" height="3" rx="1.5" fill="#79B5FF" />
      <rect x="12" y="21" width="24" height="3" rx="1.5" fill="#BFDBFF" />
      <path d="M22 34a6 6 0 0 1 6-6h22a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6h-2v6l-8-6H28a6 6 0 0 1-6-6z" fill="#3395FF" stroke="#0B1D3A" strokeOpacity="0.35" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="27" y="34" width="14" height="3" rx="1.5" fill="#FFFFFF" opacity="0.9" />
      <rect x="27" y="41" width="20" height="3" rx="1.5" fill="#FFFFFF" opacity="0.6" />
      <g transform="rotate(-8 50 30)">
        <rect x="40" y="24" width="22" height="11" rx="2.5" fill="#FFFFFF" stroke="#12B76A" strokeWidth="1.8" />
        <path d="M44 29.5h14" stroke="#087443" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function LedgerChainGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14" fill="none" aria-hidden="true">
      <path d="M10 14c8-2 16-2 22 0v36c-6-2-14-2-22 0z" fill="#FFFFFF" stroke="#1E3A6E" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M32 14c6-2 14-2 22 0v36c-8-2-16-2-22 0z" fill="#FFFFFF" stroke="#1E3A6E" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="30" y="12" width="4" height="40" rx="1.5" fill="#7A1F1A" />
      {[22, 29, 36].map((y) => (
        <g key={y}>
          <path d={`M14 ${y}h14`} stroke="#BFDBFF" strokeWidth="1.2" />
          <path d={`M36 ${y}h14`} stroke="#BFDBFF" strokeWidth="1.2" />
        </g>
      ))}
      <rect x="14" y="19.5" width="9" height="2.5" rx="1.25" fill="#79B5FF" />
      <rect x="36" y="19.5" width="11" height="2.5" rx="1.25" fill="#79B5FF" />
      <rect x="20" y="26.5" width="8" height="2.5" rx="1.25" fill="#0B1D3A" opacity="0.7" />
      <g transform="translate(38 38)">
        <rect x="0" y="0" width="10" height="6" rx="3" stroke="#1E5FBF" strokeWidth="1.6" />
        <rect x="7" y="4" width="10" height="6" rx="3" stroke="#1E5FBF" strokeWidth="1.6" fill="#FFFFFF" />
      </g>
      <circle cx="12" cy="52" r="6" fill="#12B76A" />
      <path d="m9.5 52 1.8 1.8 3.2-3.6" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Steps                                                              */
/* ------------------------------------------------------------------ */

interface Step {
  title: string;
  body: string;
  glyph: ReactNode;
}

const STEPS: readonly Step[] = [
  {
    title: "Merchant sets the rules",
    body: "Price floor, discount cap, order limits, a category allowlist and a gate above which the owner decides. AI drafts them from a messy catalog; a human approves.",
    glyph: <RulebookGlyph />,
  },
  {
    title: "Agents negotiate inside them",
    body: "A buyer agent arrives with a signed mandate. The seller agent searches, bundles and counters — but every offer passes a deterministic policy engine first. The model never touches money.",
    glyph: <NegotiateGlyph />,
  },
  {
    title: "Every rupee is written down",
    body: "ALLOW, COUNTER, GATE, DENY, PAID or FAILED — each lands in a hash-chained ledger with its reason and checks. Edit a row and the chain flags it.",
    glyph: <LedgerChainGlyph />,
  },
];

/* ------------------------------------------------------------------ */
/*  Verdict sample (a real ALLOW for the ₹1,849 bundle on a ₹2,000 mandate) */
/* ------------------------------------------------------------------ */

const VERDICT_SAMPLE = `{
  "decision": "ALLOW",
  "reason_code": "OK",
  "human_reason": "₹1,849 is inside every rule — cap, floor, category and limits all pass.",
  "policy_checks": [
    { "rule": "mandate_expiry",   "result": "pass", "detail": "valid for 1740s more" },
    { "rule": "mandate_replay",   "result": "pass", "detail": "nonce unused" },
    { "rule": "category_scope",   "result": "pass", "detail": "all items within {handloom, gifts}" },
    { "rule": "sku_exists",       "result": "pass", "detail": "2 SKU(s) resolved" },
    { "rule": "order_value_limit","result": "pass", "detail": "184900 <= 1000000" },
    { "rule": "qty_limit",        "result": "pass", "detail": "1 <= 4" },
    { "rule": "spend_cap",        "result": "pass", "detail": "184900 <= cap 200000" },
    { "rule": "price_floor",      "result": "pass", "detail": "184900 >= floor 157165" },
    { "rule": "discount_limit",   "result": "pass", "detail": "0% <= 10%" },
    { "rule": "high_value_gate",  "result": "pass", "detail": "184900 <= 500000" }
  ]
}`;

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g;

/** Deterministic token colouring for the JSON sample — keys, strings, numbers. */
function highlightLine(line: string, lineIndex: number): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of line.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<span key={`${lineIndex}-t${n++}`}>{line.slice(last, start)}</span>);
    const [whole, str, colon, num, lit] = m;
    if (str !== undefined) {
      const isKey = colon !== undefined;
      const isDecision = str === '"ALLOW"';
      out.push(
        <span key={`${lineIndex}-t${n++}`} className={cn(isKey ? "text-[#8CC4FF]" : isDecision ? "font-semibold text-[#5CE8A4]" : "text-[#CDEFD9]")}>
          {str}
        </span>,
      );
      if (colon) out.push(<span key={`${lineIndex}-t${n++}`}>{colon}</span>);
    } else if (num !== undefined) {
      out.push(
        <span key={`${lineIndex}-t${n++}`} className="text-[#FFD08A]">
          {num}
        </span>,
      );
    } else if (lit !== undefined) {
      out.push(
        <span key={`${lineIndex}-t${n++}`} className="text-[#FFD08A]">
          {lit}
        </span>,
      );
    } else {
      out.push(<span key={`${lineIndex}-t${n++}`}>{whole}</span>);
    }
    last = start + whole.length;
  }
  if (last < line.length) out.push(<span key={`${lineIndex}-t${n++}`}>{line.slice(last)}</span>);
  return out;
}

function VerdictPanel() {
  const lines = VERDICT_SAMPLE.split("\n");
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-rzp-navy/95 text-white shadow-lift backdrop-blur-md">
      <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B6B]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FFC857]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#5CE8A4]" />
        </span>
        <span className="font-mono text-xs text-white/70">verdict · POST /api/agent/negotiate</span>
        <span className="rounded-full border border-[#5CE8A4]/40 bg-[#5CE8A4]/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5CE8A4]">
          allow
        </span>
      </figcaption>
      <div className="overflow-x-auto">
        <pre className="scrollbar-thin px-4 py-4 font-mono text-[12px] leading-[1.55] text-white/85 sm:text-[13px]">
          <code>
            {lines.map((line, i) => (
              <span key={i} className="block whitespace-pre">
                {highlightLine(line, i)}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-24 border-y border-rzp-border bg-rzp-mist px-4 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rzp-blueDeep">How it works</p>
          <h2 id="how-heading" className="mt-2 font-display text-3xl font-bold tracking-tight text-rzp-navy sm:text-4xl">
            Humans set the rules. Agents trade inside them. The book keeps score.
          </h2>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-14">
          <ol className="relative space-y-10">
            <span aria-hidden="true" className="absolute bottom-6 left-7 top-6 hidden w-px bg-gradient-to-b from-rzp-blue/40 via-rzp-blue/25 to-transparent sm:block" />
            {STEPS.map((step) => (
              <li key={step.title} className="relative flex gap-5">
                <span className="relative z-10 grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-rzp-border bg-white shadow-card">
                  {step.glyph}
                </span>
                <div className="min-w-0 pt-1">
                  <h3 className="font-display text-xl font-semibold tracking-tight text-rzp-text">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-rzp-muted sm:text-base">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="min-w-0">
            <VerdictPanel />
            <p className="mt-3 text-xs text-rzp-muted">
              A real verdict shape: the decision, a stable reason code, one plain sentence and every rule the engine checked. The same object lands in the ledger and on the chat bubble.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
