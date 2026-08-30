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
}

export function Slider({ id, label, value, min, max, step = 1, format, onChange, hint, className }: SliderProps) {
  const display = format ? format(value) : String(value);
  return (
    <div className={cn("py-2", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium text-ink/80">
          {label}
        </label>
        <span className="font-mono text-sm tnum text-ink">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-ink/10 accent-action"
        aria-valuetext={display}
      />
      {hint ? <p className="mt-1 text-xs text-ink/50">{hint}</p> : null}
    </div>
  );
}
