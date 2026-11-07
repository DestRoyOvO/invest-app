// Label for how old shown data is, used by StaleBanner. Kept free of React so it can be tested.

import { formatShortDate, formatTime } from "@/lib/format";
import type { Lang } from "@/types/api";

/** "14:05" for data fetched today (in the reader's time zone), "Nov 6 16:00" for anything older. */
export function staleSinceLabel(since: string | number, lang: Lang, now: number = Date.now(), timeZone?: string): string {
  const day = (value: string | number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const time = formatTime(since, lang, timeZone);
  return day(since) === day(now) ? time : `${formatShortDate(since, lang, timeZone)} ${time}`;
}
