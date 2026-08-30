import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F6F3EC",
        ink: "#1B1F3A",
        spine: "#7A1F1A",
        money: "#1E6E52",
        turmeric: "#B77913",
        violet: "#6B5CA5",
        deny: "#C0392B",
        action: "#28356A",
        /* payment surfaces only — Razorpay checkout accents */
        "rzp-blue": "#3395FF",
        "rzp-navy": "#072654",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "var(--font-devanagari)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: {
        "6xl": "72rem",
      },
    },
  },
  plugins: [],
};

export default config;
