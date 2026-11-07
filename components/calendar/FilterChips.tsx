"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";
import { EVENT_FILTERS, type EventFilter } from "@/lib/events";
import { tpl } from "@/lib/format";

interface FilterChipsProps {
  /** Events per group in the current period; null while loading. */
  counts: Record<EventFilter, number> | null;
  active: ReadonlySet<EventFilter>;
  onToggle: (filter: EventFilter) => void;
  className?: string;
}

/** Toggle chips for the event groups (Holdings, Watchlist, Top 78, Macro) with their counts. */
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
            aria-label={n === undefined ? f[filter] : tpl(f.count, { label: f[filter], n })}
            onClick={() => onToggle(filter)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-xs border border-line-2 px-2 text-xs transition-colors max-sm:h-10 max-sm:px-3",
              pressed ? "bg-panel-2 font-medium text-fg shadow-[inset_0_-2px_0_var(--accent)]" : "bg-panel text-fg-2 hover:bg-hover hover:text-fg",
            )}
          >
            <span>{f[filter]}</span>
            {n === undefined ? null : <span className="num font-normal text-fg-3">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
