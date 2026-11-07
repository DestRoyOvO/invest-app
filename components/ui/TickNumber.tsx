"use client";

import type { ReactNode } from "react";

import { useTickFlash } from "@/hooks/useTickFlash";
import { cn } from "@/lib/cn";

interface TickNumberProps {
  /** The raw value: a change between refreshes flashes this element only. */
  value: number | null | undefined;
  /** The formatted text; defaults to the raw value. */
  children?: ReactNode;
  className?: string;
}

/**
 * A live number that flashes briefly (green or red by direction, following the color convention) when it changes
 * between refreshes. Use it for last price, change and P&L cells so a reader sees exactly which value just moved.
 */
export function TickNumber({ value, children, className }: TickNumberProps) {
  const ref = useTickFlash<HTMLSpanElement>(value);
  return (
    <span ref={ref} className={cn("num -mx-0.5 rounded-xs px-0.5", className)}>
      {children ?? value ?? "—"}
    </span>
  );
}
