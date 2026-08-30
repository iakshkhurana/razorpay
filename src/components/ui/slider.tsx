"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
  className?: string;
  disabled?: boolean;
}

/* Native range input, restyled: blue fill up to the value, white thumb with a blue ring. */
const THUMB =
  "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-rzp-blue [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(20,33,61,0.22)] " +
  "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-rzp-blue " +
  "[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(20,33,61,0.22)]";

export function Slider({ id, label, value, min, max, step = 1, format, onChange, hint, className, disabled = false }: SliderProps) {
  const display = format ? format(value) : String(value);
  const span = max - min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  const fill = `linear-gradient(to right, var(--rzp-blue) 0%, var(--rzp-blue) ${pct}%, var(--rzp-border) ${pct}%, var(--rzp-border) 100%)`;

  return (
    <div className={cn("py-2", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium text-rzp-text">
          {label}
        </label>
        <span className="shrink-0 rounded-md bg-rzp-mist2 px-2 py-0.5 font-mono text-sm font-semibold tnum text-rzp-text">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ backgroundImage: fill }}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full bg-rzp-border accent-rzp-blue",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rzp-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          "disabled:cursor-not-allowed disabled:opacity-60",
          THUMB,
        )}
        aria-valuetext={display}
      />
      {hint ? <p className="mt-1.5 text-xs text-rzp-muted">{hint}</p> : null}
    </div>
  );
}
