import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-xl border border-rzp-border bg-white px-3 py-2 text-sm text-rzp-text shadow-sm placeholder:text-rzp-muted " +
  "transition-[border-color,box-shadow] duration-150 hover:border-[#C9D6EC] " +
  "focus:border-rzp-blue focus:outline-none focus:ring-2 focus:ring-rzp-blue/30 focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:bg-rzp-mist disabled:text-rzp-muted " +
  "aria-[invalid=true]:border-rzp-red aria-[invalid=true]:focus:ring-rzp-red/30";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(base, className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(base, "min-h-[120px] font-mono text-xs leading-relaxed", className)} {...props} />;
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-rzp-text", className)} {...props} />;
}

/** Small helper line under a field. Pass `error` to turn it red with role="alert". */
export function FieldHint({ className, error = false, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { error?: boolean }) {
  return <p role={error ? "alert" : undefined} className={cn("mt-1.5 text-xs", error ? "text-[#B3262C]" : "text-rzp-muted", className)} {...props} />;
}
