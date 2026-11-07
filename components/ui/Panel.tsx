import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface PanelProps {
  title?: ReactNode;
  /** Bloomberg-style function code shown as a small amber chip before the title, e.g. "GP", "FA", "WL". */
  code?: string;
  /** Right side of the header: tabs, buttons, meta text. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  id?: string;
}

/**
 * Flat terminal panel: a 36px header on --panel-2 with the panel title (and optional function code), then the body at
 * natural height. Stack panels in a `flex flex-col gap-px` column inside a `grid gap-px bg-line p-px` page grid so the
 * 1px gaps draw the rules (see docs/design-system.md, layout).
 */
export function Panel({ title, code, actions, children, className, bodyClassName, footer, id }: PanelProps) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={cn("flex min-w-0 flex-col bg-panel", className)}>
      {title !== undefined && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            {code ? <PanelCode code={code} /> : null}
            <h2 id={headingId} className="panel-title truncate">
              {title}
            </h2>
          </div>
          {actions ? <div className="flex min-w-0 shrink-0 items-center gap-1">{actions}</div> : null}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
      {footer}
    </section>
  );
}

/**
 * The amber function-code chip used in panel headers. Decorative for screen readers: the heading carries the name,
 * and the codes themselves are typed into the command bar.
 */
export function PanelCode({ code, className }: { code: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mono inline-flex h-[1.125rem] shrink-0 items-center rounded-xs border border-accent/50 px-1 text-[0.6875rem] leading-none font-semibold text-accent",
        className,
      )}
    >
      {code}
    </span>
  );
}

/** Small muted meta text for panel headers, e.g. "Updated 16:00". Sans 11px in --fg-3, so the title stays strongest. */
export function PanelMeta({ children }: { children: ReactNode }) {
  return <span className="num truncate text-micro text-fg-3">{children}</span>;
}
