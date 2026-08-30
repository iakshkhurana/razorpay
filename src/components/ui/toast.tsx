"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  text: string;
  tone: "ink" | "money" | "deny";
}

interface ToastContextValue {
  toast: (text: string, tone?: Toast["tone"]) => void;
}

const ToastContext = React.createContext<ToastContextValue>({ toast: () => undefined });

export function useToast(): ToastContextValue {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const counter = React.useRef(0);

  const toast = React.useCallback((text: string, tone: Toast["tone"] = "ink") => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev, { id, text, tone }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-write-in rounded-xl border bg-paper px-4 py-2.5 text-sm shadow-sm",
              t.tone === "money" && "border-money/40 text-money",
              t.tone === "deny" && "border-deny/40 text-deny",
              t.tone === "ink" && "border-ink/15 text-ink",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
