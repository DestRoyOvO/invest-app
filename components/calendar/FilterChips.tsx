"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";
import { EVENT_FILTERS, type EventFilter } from "@/lib/events";

interface FilterChipsProps {
  /** Events per group in the current period; null while loading. */
  counts: Record<EventFilter, number> | null;
  active: ReadonlySet<EventFilter>;
  onToggle: (filter: EventFilter) => void;
  className?: string;
}

/**
 * Toggle chips for the event groups (Holdings, Watchlist, Top 78, Macro) with their counts. The accessible name is the
 * visible text plus a hidden noun ("Holdings 3 events"), so voice control can use what is on screen (WCAG 2.5.3).
 */
export function FilterChips({ counts, active, onToggle, className }: FilterChipsProps) {
  const { t } = usePrefs();
  const f = t.calendar.filters;
  return (
    <div role="group" aria-label={f.label} className={cn("flex flex-wrap gap-1.5", className)}>
      {EVENT_FILTERS.map((filter) => {
        const pressed = active.has(filter);
        const n = counts?.[filter];
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(filter)}
            className={cn(
              "inline-flex h-7 items-center rounded-xs border border-line-2 px-2 text-xs transition-colors max-sm:h-10 max-sm:px-3",
              pressed ? "bg-panel-2 font-medium text-fg shadow-[inset_0_-2px_0_var(--accent)]" : "bg-panel text-fg-2 hover:bg-hover hover:text-fg",
            )}
          >
            <span>
              {f[filter]}
              {n === undefined ? null : (
                <>
                  {" "}
                  <span className="num ml-0.5 font-normal text-fg-3">{n}</span>
                  <span className="sr-only"> {n === 1 ? f.eventOne : f.eventOther}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
