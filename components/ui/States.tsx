"use client";

import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";

import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xs bg-panel-2", className)} />;
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

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-fg-3", className)}>
      <Inbox aria-hidden className="size-5 opacity-70" strokeWidth={1.5} />
      <div className="max-w-sm">{children}</div>
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

/** Thin banner shown above data when the latest refresh failed but older data is still displayed. */
export function StaleBanner({ show }: { show: boolean }) {
  const t = useT();
  if (!show) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-1.5 text-xs text-warn">
      <AlertTriangle aria-hidden className="size-3.5" strokeWidth={1.75} />
      {t.common.staleData}
    </div>
  );
}
