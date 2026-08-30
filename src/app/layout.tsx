import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Inter_Tight,
  Spline_Sans_Mono,
  Noto_Sans_Devanagari,
} from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-body",
});

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600"],
  variable: "--font-devanagari",
});

export const metadata: Metadata = {
  title: "AgentGate — Har paisa, likha hua.",
  description:
    "Every rupee your AI sells — explained, bounded, and written down. Safe agentic commerce for small merchants on Razorpay rails.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} ${devanagari.variable} font-body bg-paper text-ink antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
