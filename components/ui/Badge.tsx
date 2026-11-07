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

/**
 * Short status word in a hairline box (sans 600, 11px caps). The up and down tones are for prices and P&L only: model
 * readings, verdicts and risk levels use neutral, warn or info, never a buy or sell color.
 */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-xs border px-1.5 text-[0.6875rem] leading-none font-semibold tracking-[0.04em] whitespace-nowrap uppercase",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A keyboard key, e.g. <Kbd>/</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-2 bg-panel-2 px-1 text-xs text-fg-3">{children}</kbd>;
}

type AiChipTone = "accent" | "muted" | "current";

const AI_TONES: Record<AiChipTone, string> = {
  accent: "border-accent text-accent",
  muted: "border-fg-3 text-fg-3",
  // Inherits the text color, e.g. inside a primary button.
  current: "border-current",
};

/**
 * The "AI" text chip that marks AI features (mono 600, 10px, 1px border), in place of a sparkle icon. Decorative by
 * default: the control next to it carries the accessible name.
 */
export function AiChip({ tone = "accent", className }: { tone?: AiChipTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("mono inline-flex h-4 shrink-0 items-center rounded-xs border px-[3px] text-[0.625rem] leading-none font-semibold", AI_TONES[tone], className)}
    >
      AI
    </span>
  );
}
