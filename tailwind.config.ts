import type { Config } from "tailwindcss";

/**
 * Design tokens.
 *
 * `rzp.*` is the current visual system: a blue tuned away from Razorpay's exact
 * hue, navy chrome, mist/ice backgrounds, white cards, a teal/cyan second accent
 * lifted from the brand mark and one warm saffron for sparing highlights. The
 * older bahi-khata tokens (paper / ink / spine / money / turmeric / violet / deny
 * / action) stay so the stamp + ledger identity and every existing page keep
 * compiling.
 */
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
        rzp: {
          blue: "#2F6BFF",
          blueHover: "#245BE6",
          blueDeep: "#1B45B8",
          sky: "#DCE9FF",
          ice: "#F3F7FF",
          navy: "#0B1D3A",
          text: "#14213D",
          muted: "#5B6B8C",
          border: "#E3EAF5",
          mist: "#F4F8FF",
          mist2: "#EEF4FF",
          teal: "#17A9CC",
          cyan: "#2EC4E6",
          saffron: "#FF7A1A",
          green: "#12B76A",
          amber: "#F59E0B",
          red: "#E5484D",
          violet: "#7C5CFF",
          /** the brand image's own background — logo tiles sit on this */
          logo: "#212830",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "var(--font-devanagari)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: {
        "6xl": "72rem",
      },
      boxShadow: {
        card: "0 8px 30px rgba(20, 33, 61, 0.08)",
        lift: "0 16px 40px rgba(20, 33, 61, 0.14)",
        glow: "0 8px 24px rgba(47, 107, 255, 0.35)",
        pill: "0 6px 18px rgba(11, 29, 58, 0.22)",
      },
      backgroundImage: {
        hero: "linear-gradient(135deg, #2F6BFF 0%, #6FA0FF 55%, #DCE9FF 100%)",
        "brand-sweep": "linear-gradient(90deg, #FF7A1A 0%, #2F6BFF 60%, #2EC4E6 100%)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "dot-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(18, 183, 106, 0.45)" },
          "70%": { boxShadow: "0 0 0 6px rgba(18, 183, 106, 0)" },
        },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        "fade-up": "fade-up 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "dot-pulse": "dot-pulse 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
};

/*
 * Exported CommonJS-style on purpose. Tailwind loads this file with a plain
 * `require()`, and on Node 23.6+ (native type stripping) an ESM-syntax .ts file
 * lands in the ESM loader's cache, which can never be evicted — token changes
 * then need a full `next dev` restart. A CommonJS export goes through the CJS
 * loader, so edits here hot-reload. On older Node versions Tailwind's jiti
 * fallback handles this form just as well.
 */
module.exports = config;
