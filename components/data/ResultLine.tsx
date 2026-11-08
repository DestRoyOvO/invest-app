"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The line that reports a finished action (a restore, an import, a clear), usually with Undo. It takes keyboard focus
 * when it appears: the button that was pressed is gone or disabled by then, and focus would otherwise fall back to the
 * page. React's autoFocus only applies to form controls, so the line focuses itself once it is mounted; give it a new
 * key to announce a second result in the same place.
 */
export function ResultLine({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} role="status" tabIndex={-1} className={cn("flex flex-wrap items-center gap-x-3 text-sm text-fg-2 focus:outline-none", className)}>
      {children}
    </div>
  );
}
