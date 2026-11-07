import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface PanelProps {
  title?: ReactNode;
  /** Right side of the header: tabs, buttons, meta text. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  id?: string;
}

/** Flat terminal panel with a hairline header. Place panels in a `grid gap-px bg-line p-px` container for 1px rules. */
export function Panel({ title, actions, children, className, bodyClassName, footer, id }: PanelProps) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={cn("flex min-w-0 flex-col bg-panel", className)}>
      {title !== undefined && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
          <h2 id={headingId} className="label truncate">
            {title}
          </h2>
          {actions ? <div className="flex min-w-0 shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
      {footer}
    </section>
  );
}

/** Small muted meta text for panel headers, e.g. "Updated 16:00". */
export function PanelMeta({ children }: { children: ReactNode }) {
  return <span className="num truncate text-xs text-fg-3">{children}</span>;
}
