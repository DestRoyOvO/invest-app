"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { usePrefs, useT } from "@/components/providers/PrefsProvider";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";

import { Button } from "./Button";
import { staleSinceLabel } from "./stale";

/** Loading placeholder: a --line block with a pulse, visible on both panel colors. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xs bg-line", className)} />;
}

/** A stack of skeleton rows for tables and lists. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-3", className)} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5" />
      ))}
    </div>
  );
}

export interface StarterChip {
  label: string;
  /** Runs on click, e.g. adds the symbol to the watchlist. */
  onSelect?: () => void;
  /** Or navigates. */
  href?: string;
}

interface EmptyStateProps {
  /** The prompt line: what is missing and how to start, in plain words. */
  children: ReactNode;
  /** One-click starters such as tickers to add, shown as mono chips. */
  chips?: readonly StarterChip[];
  /** Accessible name of the chip group, e.g. "Add a ticker". */
  chipsLabel?: string;
  /** Buttons, e.g. "Add tickers" and "Paste positions". */
  actions?: ReactNode;
  /** A quieter last line, e.g. a keyboard hint. */
  hint?: ReactNode;
  className?: string;
}

const chipClass =
  "mono inline-flex h-7 items-center rounded-xs border border-line-2 px-2 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent max-sm:h-10 max-sm:px-3";

/** Left-aligned empty state: a prompt line with optional starter chips, actions and a hint. No icon, no centered void. */
export function EmptyState({ children, chips, chipsLabel, actions, hint, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-start gap-2.5 px-3 py-4 text-sm text-fg-2", className)}>
      <div className="max-w-prose">{children}</div>
      {chips && chips.length > 0 ? (
        <ul aria-label={chipsLabel} className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li key={chip.label}>
              {chip.href ? (
                <Link href={chip.href} className={chipClass}>
                  {chip.label}
                </Link>
              ) : (
                <button type="button" onClick={chip.onSelect} className={chipClass}>
                  {chip.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      {hint ? <div className="text-xs text-fg-3">{hint}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

/** Error message with an optional retry button. Messages are generic; details stay on the server. */
export function ErrorState({ error, title, onRetry, className, compact = false }: ErrorStateProps) {
  const t = useT();
  const message =
    error instanceof ApiError
      ? error.code === "network"
        ? t.errors.network
        : error.code === "not_found"
          ? t.errors.notFound
          : t.errors.upstream
      : t.common.error;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 text-sm",
        compact ? "px-3 py-2" : "flex-col justify-center px-4 py-8 text-center",
        className,
      )}
    >
      <AlertTriangle aria-hidden className="size-4 shrink-0 text-warn" strokeWidth={1.75} />
      <div className={cn("text-fg-2", compact && "flex-1")}>
        {title ? <div className="font-medium text-fg">{title}</div> : null}
        <div>{message}</div>
      </div>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          {t.common.retry}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Thin banner above data that is no longer live: the latest refresh failed and older data is shown. Pass `since` (the
 * time that data was fetched) so the reader knows how old it is.
 */
export function StaleBanner({ show, since }: { show: boolean; since?: string | number | null }) {
  const { t, lang } = usePrefs();
  if (!show) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line bg-panel-2 px-3 py-1.5 text-xs text-warn">
      <AlertTriangle aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span>{t.common.staleData}</span>
      {since !== undefined && since !== null && since !== "" ? <span className="num text-fg-3">{tpl(t.common.asOf, { time: staleSinceLabel(since, lang) })}</span> : null}
    </div>
  );
}
