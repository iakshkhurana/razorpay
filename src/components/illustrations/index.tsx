import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Original inline-SVG illustrations in a soft blue/white documentation style:
 * rounded shapes, light shading, thin navy strokes. Every piece is drawn here —
 * no external images.
 *
 * Shared props: `className` sizes the SVG (w-64, h-auto …; natural size 240–360px),
 * `animate` floats the main object (paused under prefers-reduced-motion),
 * `title` makes the drawing a labelled image; without it the SVG is decorative (aria-hidden).
 */

export interface IllustrationProps {
  className?: string;
  animate?: boolean;
  title?: string;
}

/* ------------------------------------------------------------------ */
/*  Palette + helpers                                                  */
/* ------------------------------------------------------------------ */

const C = {
  navy: "#0B1D3A",
  stroke: "#1E3A6E",
  blue: "#3395FF",
  blueDeep: "#1E5FBF",
  blueMid: "#79B5FF",
  blueSoft: "#BFDBFF",
  blueTint: "#DCEBFF",
  mist: "#EEF4FF",
  white: "#FFFFFF",
  green: "#12B76A",
  greenText: "#087443",
  greenTint: "#ECFDF3",
  amber: "#F59E0B",
  violet: "#7C5CFF",
  spine: "#7A1F1A",
} as const;

/** ₹ drawn as strokes inside a 24×24 box, so it never depends on a font. */
const RUPEE_PATH = "M7 5h10M7 9h10M8 5h3a4 4 0 0 1 0 8H7l7 7";

type FloatVars = React.CSSProperties & { "--delay"?: string; "--float-duration"?: string };

function floatProps(animate: boolean, delaySeconds = 0, durationSeconds = 7): { className?: string; style?: FloatVars } {
  if (!animate) return {};
  return { className: "float", style: { "--delay": `${delaySeconds}s`, "--float-duration": `${durationSeconds}s` } };
}

interface FrameProps extends IllustrationProps {
  w: number;
  h: number;
  children: React.ReactNode;
}

function Frame({ w, h, title, className, children }: FrameProps) {
  const labelled = typeof title === "string" && title.length > 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      fill="none"
      className={cn("block h-auto max-w-full", className)}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {children}
    </svg>
  );
}

function Rupee({ x, y, scale, color, width = 1.8 }: { x: number; y: number; scale: number; color: string; width?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={RUPEE_PATH} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function SparklePath({ x, y, size, color, opacity = 1 }: { x: number; y: number; size: number; color: string; opacity?: number }) {
  const s = size / 24;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={opacity}>
      <path d="M12 2c.6 6 3.4 8.8 10 10-6.6 1.2-9.4 4-10 10-.6-6-3.4-8.8-10-10 6.6-1.2 9.4-4 10-10Z" fill={color} />
    </g>
  );
}

function Shadow({ cx, cy, rx, ry = 10 }: { cx: number; cy: number; rx: number; ry?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={C.navy} opacity="0.08" />;
}

/* ------------------------------------------------------------------ */
/*  Small glyphs                                                       */
/* ------------------------------------------------------------------ */

/** Four-point sparkle, currentColor. Size with className (h-4 w-4). */
export function Sparkle({ className, title }: { className?: string; title?: string }) {
  const labelled = Boolean(title);
  return (
    <svg viewBox="0 0 24 24" className={cn("inline-block h-4 w-4", className)} role={labelled ? "img" : undefined} aria-label={title} aria-hidden={labelled ? undefined : true}>
      <path d="M12 2c.6 6 3.4 8.8 10 10-6.6 1.2-9.4 4-10 10-.6-6-3.4-8.8-10-10 6.6-1.2 9.4-4 10-10Z" fill="currentColor" />
    </svg>
  );
}

/** ₹ inside a thin ring, currentColor. Size with className (h-5 w-5). */
export function RupeeMark({ className, title }: { className?: string; title?: string }) {
  const labelled = Boolean(title);
  return (
    <svg viewBox="0 0 24 24" className={cn("inline-block h-5 w-5", className)} fill="none" role={labelled ? "img" : undefined} aria-label={title} aria-hidden={labelled ? undefined : true}>
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.5" />
      <g transform="translate(5.5 5) scale(0.56)">
        <path d={RUPEE_PATH} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Floating payment card                                           */
/* ------------------------------------------------------------------ */

export function FloatingCard({ className, animate = true, title }: IllustrationProps) {
  const id = React.useId();
  const grad = `card-grad-${id}`;
  return (
    <Frame w={320} h={260} title={title} className={className}>
      <defs>
        <linearGradient id={grad} x1="60" y1="62" x2="260" y2="188" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.blue} />
          <stop offset="1" stopColor={C.blueDeep} />
        </linearGradient>
      </defs>
      <Shadow cx={160} cy={232} rx={96} />

      {/* coin peeking from behind */}
      <g {...floatProps(animate, 1.4, 8)}>
        <circle cx="68" cy="196" r="24" fill={C.blueMid} stroke={C.stroke} strokeWidth="1.5" />
        <circle cx="68" cy="196" r="17" fill={C.blueTint} />
        <Rupee x={58} y={186} scale={0.85} color={C.navy} width={2.2} />
      </g>

      {/* the card */}
      <g {...floatProps(animate, 0, 7)}>
        <g transform="rotate(-8 160 125)">
          <rect x="60" y="62" width="200" height="126" rx="16" fill={`url(#${grad})`} stroke={C.navy} strokeOpacity="0.35" strokeWidth="1.5" />
          <path d="M60 78c40-8 78 26 118 20s52-38 82-30v40c-30-8-52 26-82 30S100 106 60 116Z" fill={C.white} opacity="0.12" />
          <rect x="84" y="92" width="34" height="26" rx="5" fill={C.blueTint} stroke={C.blueDeep} strokeWidth="1.2" />
          <path d="M84 101h34M84 109h34M101 92v26" stroke={C.blueDeep} strokeWidth="1" opacity="0.7" />
          <path d="M228 96a10 10 0 0 1 0 14M234 90a18 18 0 0 1 0 26M222 102a2 2 0 0 1 0 2" stroke={C.white} strokeWidth="2" strokeLinecap="round" opacity="0.9" />
          {[0, 1, 2].map((group) => (
            <g key={group}>
              {[0, 1, 2, 3].map((i) => (
                <circle key={i} cx={84 + group * 40 + i * 8} cy="146" r="2.4" fill={C.white} opacity="0.9" />
              ))}
            </g>
          ))}
          <text x="204" y="150" fill={C.white} fontFamily="var(--font-mono), ui-monospace, monospace" fontSize="13" fontWeight="600" letterSpacing="1">
            4242
          </text>
          <rect x="84" y="162" width="56" height="7" rx="3.5" fill={C.white} opacity="0.55" />
          <circle cx="238" cy="166" r="11" fill={C.white} opacity="0.95" />
          <Rupee x={231} y={159} scale={0.58} color={C.blueDeep} width={2.4} />
        </g>
      </g>

      <g {...floatProps(animate, 0.6, 9)}>
        <SparklePath x={34} y={44} size={26} color={C.blue} />
      </g>
      <g {...floatProps(animate, 2.2, 8)}>
        <SparklePath x={270} y={196} size={18} color={C.blueMid} />
        <SparklePath x={286} y={40} size={12} color={C.blueSoft} />
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Rupee coin                                                      */
/* ------------------------------------------------------------------ */

export function RupeeCoin({ className, animate = true, title }: IllustrationProps) {
  const id = React.useId();
  const grad = `coin-grad-${id}`;
  return (
    <Frame w={280} h={280} title={title} className={className}>
      <defs>
        <radialGradient id={grad} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor={C.blueMid} />
          <stop offset="1" stopColor={C.blue} />
        </radialGradient>
      </defs>
      <Shadow cx={140} cy={246} rx={84} />

      {/* background coins */}
      <g {...floatProps(animate, 1.8, 9)}>
        <circle cx="58" cy="206" r="26" fill={C.blueSoft} stroke={C.stroke} strokeWidth="1.5" />
        <circle cx="58" cy="206" r="18" fill={C.mist} />
        <Rupee x={49} y={197} scale={0.75} color={C.blueDeep} width={2.4} />
      </g>
      <g {...floatProps(animate, 3, 8)}>
        <circle cx="234" cy="68" r="18" fill={C.blueTint} stroke={C.stroke} strokeWidth="1.5" />
        <Rupee x={226} y={60} scale={0.66} color={C.blueDeep} width={2.4} />
      </g>

      {/* the coin */}
      <g {...floatProps(animate, 0, 7)}>
        <circle cx="140" cy="132" r="92" fill={`url(#${grad})`} stroke={C.stroke} strokeWidth="1.5" />
        <circle cx="140" cy="132" r="86" stroke={C.white} strokeWidth="2" strokeDasharray="3 7" opacity="0.7" />
        <circle cx="140" cy="132" r="72" fill={C.blueTint} stroke={C.white} strokeWidth="3" />
        <path d="M96 100c10-18 28-30 48-32" stroke={C.white} strokeWidth="4" strokeLinecap="round" opacity="0.7" />
        <Rupee x={92} y={84} scale={4} color={C.navy} width={2} />
      </g>

      <g {...floatProps(animate, 0.8, 8)}>
        <SparklePath x={36} y={60} size={24} color={C.blue} />
        <SparklePath x={224} y={210} size={16} color={C.blueMid} />
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Open ledger page with a rubber stamp                            */
/* ------------------------------------------------------------------ */

export function LedgerStamp({ className, animate = true, title }: IllustrationProps) {
  return (
    <Frame w={340} h={260} title={title} className={className}>
      <Shadow cx={170} cy={236} rx={120} />

      {/* page stack */}
      <path d="M44 78c40-6 82-6 122 0v146c-40-6-82-6-122 0Z" fill={C.mist} transform="translate(0 6)" />
      <path d="M174 78c40-6 82-6 122 0v146c-40-6-82-6-122 0Z" fill={C.mist} transform="translate(0 6)" />
      {/* pages */}
      <path d="M44 72c40-6 82-6 122 0v146c-40-6-82-6-122 0Z" fill={C.white} stroke={C.stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M174 72c40-6 82-6 122 0v146c-40-6-82-6-122 0Z" fill={C.white} stroke={C.stroke} strokeWidth="1.5" strokeLinejoin="round" />
      {/* cloth spine */}
      <rect x="163" y="64" width="14" height="160" rx="4" fill={C.spine} />
      <path d="M170 70v148" stroke={C.white} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4 5" />

      {/* ruled lines */}
      {[96, 118, 140, 162, 184, 206].map((y) => (
        <React.Fragment key={y}>
          <path d={`M58 ${y}h96`} stroke={C.blueSoft} strokeWidth="1" />
          <path d={`M188 ${y}h96`} stroke={C.blueSoft} strokeWidth="1" />
        </React.Fragment>
      ))}

      {/* handwriting bars: left page — description + amount */}
      {[
        { y: 88, w: 58, amt: 22 },
        { y: 110, w: 70, amt: 26 },
        { y: 132, w: 46, amt: 20 },
        { y: 154, w: 64, amt: 24 },
      ].map((row) => (
        <React.Fragment key={row.y}>
          <rect x="60" y={row.y} width={row.w} height="6" rx="3" fill={C.blueMid} opacity="0.8" />
          <rect x={150 - row.amt} y={row.y} width={row.amt} height="6" rx="3" fill={C.navy} opacity="0.75" />
        </React.Fragment>
      ))}
      {/* right page — one entry with a big amount */}
      <rect x="190" y="88" width="72" height="6" rx="3" fill={C.blueMid} opacity="0.8" />
      <rect x="190" y="110" width="40" height="6" rx="3" fill={C.blueSoft} />
      <Rupee x={236} y={102} scale={0.7} color={C.navy} width={2.4} />
      <rect x="254" y="110" width="28" height="6" rx="3" fill={C.navy} opacity="0.75" />

      {/* stamp impression */}
      <g transform="rotate(-8 240 170)">
        <rect x="196" y="152" width="88" height="36" rx="6" fill={C.greenTint} stroke={C.green} strokeWidth="3" />
        <text
          x="240"
          y="177"
          textAnchor="middle"
          fill={C.greenText}
          fontFamily="var(--font-display), system-ui, sans-serif"
          fontSize="16"
          fontWeight="800"
          letterSpacing="3"
        >
          ALLOW
        </text>
      </g>

      {/* the rubber stamp itself, hovering above the page */}
      <g {...floatProps(animate, 0, 6)}>
        <rect x="222" y="14" width="36" height="24" rx="8" fill={C.blueDeep} stroke={C.navy} strokeOpacity="0.4" strokeWidth="1.2" />
        <rect x="230" y="36" width="20" height="10" rx="3" fill={C.blueMid} />
        <rect x="206" y="44" width="68" height="16" rx="5" fill={C.blue} stroke={C.navy} strokeOpacity="0.4" strokeWidth="1.2" />
        <rect x="210" y="60" width="60" height="5" rx="2" fill={C.green} opacity="0.85" />
      </g>

      <g {...floatProps(animate, 1.6, 8)}>
        <SparklePath x={296} y={126} size={16} color={C.green} opacity={0.9} />
        <SparklePath x={20} y={40} size={22} color={C.blue} />
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Shield with a check                                             */
/* ------------------------------------------------------------------ */

export function ShieldCheck({ className, animate = true, title }: IllustrationProps) {
  const id = React.useId();
  const grad = `shield-grad-${id}`;
  return (
    <Frame w={280} h={280} title={title} className={className}>
      <defs>
        <linearGradient id={grad} x1="60" y1="40" x2="220" y2="240" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.blue} />
          <stop offset="1" stopColor={C.blueDeep} />
        </linearGradient>
      </defs>
      <Shadow cx={140} cy={254} rx={72} />

      {/* soft halo */}
      <circle cx="140" cy="140" r="112" fill={C.mist} />
      <circle cx="140" cy="140" r="112" stroke={C.blueSoft} strokeWidth="1.5" strokeDasharray="2 8" />

      <g {...floatProps(animate, 0, 7)}>
        <path
          d="M140 32 222 62v66c0 58-36 98-82 118-46-20-82-60-82-118V62Z"
          fill={`url(#${grad})`}
          stroke={C.navy}
          strokeOpacity="0.35"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M140 60 198 82v46c0 44-26 74-58 90-32-16-58-46-58-90V82Z" fill={C.white} opacity="0.96" />
        <path d="M140 60 198 82v46c0 6-.4 12-1.4 18L140 60Z" fill={C.blueTint} opacity="0.6" />
        <path d="M106 138 130 162 176 110" stroke={C.green} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* small orbiting locks / dots */}
      <g {...floatProps(animate, 1.2, 9)}>
        <circle cx="52" cy="92" r="9" fill={C.blueMid} />
        <circle cx="236" cy="196" r="7" fill={C.blueSoft} />
      </g>
      <g {...floatProps(animate, 2.4, 8)}>
        <SparklePath x={214} y={44} size={24} color={C.blue} />
        <SparklePath x={32} y={196} size={16} color={C.green} opacity={0.9} />
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/*  5. Chat bubble with a verdict stamp                                */
/* ------------------------------------------------------------------ */

export function ChatVerdict({ className, animate = true, title }: IllustrationProps) {
  const id = React.useId();
  const grad = `chat-grad-${id}`;
  return (
    <Frame w={340} h={260} title={title} className={className}>
      <defs>
        <linearGradient id={grad} x1="120" y1="132" x2="310" y2="206" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.blue} />
          <stop offset="1" stopColor={C.blueDeep} />
        </linearGradient>
      </defs>
      <Shadow cx={170} cy={240} rx={110} />

      {/* seller bubble (left, white) */}
      <g {...floatProps(animate, 1, 8)}>
        <path d="M48 34h164a16 16 0 0 1 16 16v44a16 16 0 0 1-16 16H72l-22 18v-18h-2a16 16 0 0 1-16-16V50a16 16 0 0 1 16-16Z" fill={C.white} stroke={C.stroke} strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="52" y="52" width="120" height="7" rx="3.5" fill={C.blueMid} opacity="0.85" />
        <rect x="52" y="68" width="150" height="7" rx="3.5" fill={C.blueSoft} />
        <rect x="52" y="84" width="84" height="7" rx="3.5" fill={C.blueSoft} />
      </g>

      {/* buyer bubble (right, blue) */}
      <g {...floatProps(animate, 0, 7)}>
        <path d="M128 128h164a16 16 0 0 1 16 16v44a16 16 0 0 1-16 16h-2v18l-22-18H128a16 16 0 0 1-16-16v-44a16 16 0 0 1 16-16Z" fill={`url(#${grad})`} stroke={C.navy} strokeOpacity="0.35" strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="132" y="146" width="96" height="7" rx="3.5" fill={C.white} opacity="0.85" />
        <rect x="132" y="162" width="130" height="7" rx="3.5" fill={C.white} opacity="0.6" />
        <rect x="132" y="178" width="60" height="7" rx="3.5" fill={C.white} opacity="0.6" />
        <Rupee x={198} y={172} scale={0.62} color={C.white} width={2.6} />
        {/* stamp pressed on the corner */}
        <g transform="rotate(-8 268 126)">
          <rect x="222" y="108" width="92" height="36" rx="6" fill={C.white} stroke={C.green} strokeWidth="3" />
          <text
            x="268"
            y="133"
            textAnchor="middle"
            fill={C.greenText}
            fontFamily="var(--font-display), system-ui, sans-serif"
            fontSize="16"
            fontWeight="800"
            letterSpacing="3"
          >
            ALLOW
          </text>
        </g>
      </g>

      {/* typing bubble */}
      <g {...floatProps(animate, 2, 9)}>
        <rect x="32" y="194" width="66" height="30" rx="15" fill={C.white} stroke={C.stroke} strokeWidth="1.5" />
        <circle cx="52" cy="209" r="4" fill={C.blueMid} />
        <circle cx="65" cy="209" r="4" fill={C.blue} />
        <circle cx="78" cy="209" r="4" fill={C.blueDeep} />
      </g>

      <g {...floatProps(animate, 1.4, 8)}>
        <SparklePath x={300} y={40} size={22} color={C.blue} />
        <SparklePath x={16} y={128} size={16} color={C.blueMid} />
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/*  6. Small storefront                                                */
/* ------------------------------------------------------------------ */

export function Storefront({ className, animate = true, title }: IllustrationProps) {
  const scallops = [48, 80, 112, 144, 176, 208, 240];
  return (
    <Frame w={320} h={260} title={title} className={className}>
      <Shadow cx={160} cy={236} rx={120} />

      {/* ground line */}
      <path d="M40 222h240" stroke={C.blueSoft} strokeWidth="2" strokeLinecap="round" />

      {/* body */}
      <rect x="60" y="118" width="200" height="104" rx="6" fill={C.white} stroke={C.stroke} strokeWidth="1.5" />
      <rect x="60" y="118" width="200" height="14" fill={C.mist} />

      {/* door */}
      <rect x="92" y="150" width="42" height="72" rx="5" fill={C.blueMid} stroke={C.stroke} strokeWidth="1.5" />
      <rect x="98" y="156" width="30" height="30" rx="3" fill={C.blueTint} />
      <circle cx="126" cy="194" r="2.5" fill={C.navy} />

      {/* window with products */}
      <rect x="156" y="150" width="82" height="46" rx="6" fill={C.blueTint} stroke={C.stroke} strokeWidth="1.5" />
      <path d="M156 173h82" stroke={C.white} strokeWidth="2" />
      <rect x="164" y="160" width="14" height="12" rx="2" fill={C.blue} />
      <rect x="183" y="158" width="18" height="14" rx="2" fill={C.blueDeep} />
      <rect x="206" y="162" width="12" height="10" rx="2" fill={C.blueMid} />
      <rect x="164" y="180" width="30" height="10" rx="2" fill={C.blueMid} />
      <rect x="200" y="178" width="26" height="12" rx="2" fill={C.blue} />

      {/* sign board */}
      <rect x="72" y="48" width="176" height="34" rx="9" fill={C.blueDeep} stroke={C.navy} strokeOpacity="0.4" strokeWidth="1.5" />
      <rect x="88" y="61" width="70" height="8" rx="4" fill={C.white} opacity="0.9" />
      <rect x="166" y="61" width="36" height="8" rx="4" fill={C.blueMid} />
      <circle cx="226" cy="65" r="9" fill={C.white} />
      <Rupee x={220} y={59} scale={0.5} color={C.blueDeep} width={2.8} />

      {/* awning with scallops */}
      <rect x="48" y="86" width="224" height="30" rx="4" fill={C.blue} stroke={C.stroke} strokeWidth="1.5" />
      {scallops.map((x, i) =>
        i % 2 === 1 ? <rect key={`stripe-${x}`} x={x} y="87.5" width="32" height="27" fill={C.white} opacity="0.9" /> : null,
      )}
      {scallops.map((x, i) => (
        <path
          key={`scallop-${x}`}
          d={`M${x} 116a16 16 0 0 0 32 0Z`}
          fill={i % 2 === 1 ? C.white : C.blue}
          stroke={C.stroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      ))}
      <path d="M48 116h224" stroke={C.stroke} strokeWidth="1.5" />

      {/* price tag floating beside the shop */}
      <g {...floatProps(animate, 0, 7)}>
        <g transform="rotate(14 276 74)">
          <path d="M258 58h30l12 16-12 16h-30a6 6 0 0 1-6-6V64a6 6 0 0 1 6-6Z" fill={C.white} stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="290" cy="74" r="3" fill={C.green} />
          <Rupee x={262} y={65} scale={0.7} color={C.greenText} width={2.6} />
        </g>
      </g>

      {/* plant pot */}
      <g {...floatProps(animate, 1.5, 9)}>
        <path d="M36 204c0-14 10-24 18-30 8 6 18 16 18 30" fill={C.green} opacity="0.85" />
        <path d="M54 176v28" stroke={C.greenText} strokeWidth="2" strokeLinecap="round" />
        <path d="M38 204h32l-4 18H42Z" fill={C.blueMid} stroke={C.stroke} strokeWidth="1.5" strokeLinejoin="round" />
      </g>

      <g {...floatProps(animate, 2.2, 8)}>
        <SparklePath x={28} y={44} size={22} color={C.blue} />
        <SparklePath x={292} y={150} size={14} color={C.blueMid} />
      </g>
    </Frame>
  );
}
