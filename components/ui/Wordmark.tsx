import { cn } from "@/lib/cn";

import { MARK } from "./brand";

/** The prompt-candle mark in the current text color (set `text-accent` for the brand amber). Decorative unless titled. */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const { chevron, wick, body } = MARK;
  return (
    <svg
      viewBox={`0 0 ${MARK.size} ${MARK.size}`}
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <polyline points={chevron.points} fill="none" stroke="currentColor" strokeWidth={chevron.strokeWidth} strokeLinecap="butt" strokeLinejoin="miter" />
      <line x1={wick.x} y1={wick.y1} x2={wick.x} y2={wick.y2} stroke="currentColor" strokeWidth={wick.strokeWidth} />
      <rect x={body.x} y={body.y} width={body.width} height={body.height} fill="currentColor" />
    </svg>
  );
}

/**
 * The mark followed by "InvestSeek" in Plex Sans 600 at 15px, with "Seek" in --fg-2. The name hides below sm unless
 * `alwaysShowName` is set; wrap it in a link with aria-label="InvestSeek".
 */
export function Wordmark({ className, alwaysShowName = false }: { className?: string; alwaysShowName?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark className="size-5 text-accent" />
      <span className={cn("text-[0.9375rem] leading-none font-semibold tracking-[-0.01em] whitespace-nowrap text-fg", alwaysShowName ? "inline" : "hidden sm:inline")}>
        Invest<span className="text-fg-2">Seek</span>
      </span>
    </span>
  );
}
