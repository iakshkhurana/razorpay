import type { ReactNode } from "react";

function LinkGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />
    </svg>
  );
}

function BoltGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 2 4 11h5l-1 7 8-10h-5z" />
    </svg>
  );
}

function BankGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8 10 3l7 5" />
      <path d="M4.5 8v7M8.2 8v7M11.8 8v7M15.5 8v7M3 15.5h14" />
    </svg>
  );
}

const PILLS: ReadonlyArray<{ label: string; icon: ReactNode }> = [
  { label: "Payment Links", icon: <LinkGlyph /> },
  { label: "Webhooks", icon: <BoltGlyph /> },
  { label: "Test netbanking", icon: <BankGlyph /> },
];

export function RailsStrip({ payments }: { payments: "mock" | "razorpay" | null }) {
  return (
    <section aria-labelledby="rails-heading" className="px-4 py-14 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 rounded-2xl border border-rzp-border bg-white px-6 py-7 shadow-card md:flex-row md:items-center md:justify-between md:px-8">
        <div className="max-w-2xl">
          <h2 id="rails-heading" className="font-display text-xl font-semibold tracking-tight text-rzp-navy sm:text-2xl">
            Built on Razorpay test-mode rails
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-rzp-muted sm:text-base">
            An allowed order becomes a Payment Link, a webhook flips the order state, and the test netbanking page&apos;s Success / Failure buttons are the live failure trigger. Mock mode runs the same flows with Wi-Fi off.
            {payments ? (
              <>
                {" "}
                <span className="whitespace-nowrap">
                  Right now: <span className="font-mono text-rzp-text">{payments === "razorpay" ? "razorpay test" : "mock"}</span>.
                </span>
              </>
            ) : null}
          </p>
        </div>
        <ul className="flex flex-wrap gap-2 md:shrink-0" aria-label="Rails in use">
          {PILLS.map((pill) => (
            <li key={pill.label} className="inline-flex items-center gap-2 rounded-full border border-rzp-blue/25 bg-rzp-blue/10 px-3.5 py-1.5 text-sm font-medium text-rzp-blueDeep">
              {pill.icon}
              {pill.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
