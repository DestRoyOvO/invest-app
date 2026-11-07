import { AGENDA_RANGES, DEFAULT_FILTERS, EVENT_FILTERS, type AgendaRange, type EventFilter } from "@/lib/events";
import { createLocalStore } from "@/lib/local-store";

// The calendar's view choices, kept in this browser only: the period and the groups shown.

export interface CalendarPrefs {
  range: AgendaRange;
  filters: EventFilter[];
}

const EMPTY: CalendarPrefs = { range: "week", filters: [...DEFAULT_FILTERS] };

export function sanitizeCalendarPrefs(raw: unknown): CalendarPrefs {
  if (!raw || typeof raw !== "object") return EMPTY;
  const value = raw as { range?: unknown; filters?: unknown };
  const range = AGENDA_RANGES.includes(value.range as AgendaRange) ? (value.range as AgendaRange) : EMPTY.range;
  const filters = Array.isArray(value.filters) ? EVENT_FILTERS.filter((f) => (value.filters as unknown[]).includes(f)) : EMPTY.filters;
  return { range, filters };
}

export const calendarPrefsStore = createLocalStore<CalendarPrefs>({
  key: "investseek:calendar:v1",
  sanitize: sanitizeCalendarPrefs,
  empty: EMPTY,
});
