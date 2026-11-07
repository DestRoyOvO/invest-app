import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "up" | "down" | "warn" | "info";

const TONES: Record<Tone, string> = {
  neutral: "border-line-2 text-fg-2",
  accent: "border-accent/40 bg-accent-soft text-accent",
  up: "border-up/40 text-up",
  down: "border-down/40 text-down",
  warn: "border-warn/40 text-warn",
  info: "border-info/40 text-info",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "num inline-flex h-5 shrink-0 items-center rounded-xs border px-1.5 text-xs leading-none tracking-wide uppercase whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-2 bg-panel-2 px-1 text-xs text-fg-3">{children}</kbd>;
}
