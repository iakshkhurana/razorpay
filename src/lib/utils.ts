import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
