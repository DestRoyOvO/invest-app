// Words for note levels and review dates, kept pure so the wording is unit tested.

import { formatPrice, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { levelDistance } from "@/lib/notes";
import type { Lang } from "@/types/api";

/** "8.9% below", "28.6% above" or "at the price"; null without a level or a price. */
export function distanceText(level: number | null | undefined, price: number | null | undefined, t: Messages): string | null {
  const distance = levelDistance(level, price);
  if (distance === null) return null;
  const pct = `${Math.abs(distance).toFixed(1)}%`;
  if (pct === "0.0%") return t.notes.atPrice;
  return tpl(distance > 0 ? t.notes.above : t.notes.below, { pct });
}

/** "stop 170.00 · 8.9% below" / "target 240.00 · 28.6% above"; just the level without a price. */
export function levelLine(kind: "target" | "stop", level: number, price: number | null | undefined, t: Messages, lang: Lang): string {
  const distance = distanceText(level, price, t);
  const formatted = formatPrice(level, lang);
  if (!distance) return formatted;
  return tpl(kind === "target" ? t.notes.targetLine : t.notes.stopLine, { level: formatted, distance });
}

/** "today", "tomorrow", "in 12 days", "1 day overdue", "3 days overdue". */
export function reviewText(days: number, t: Messages): string {
  if (days === 0) return t.notes.reviewToday;
  if (days === 1) return t.notes.reviewTomorrow;
  if (days > 1) return tpl(t.notes.reviewIn, { n: days });
  return days === -1 ? t.notes.overdueOne : tpl(t.notes.overdue, { n: -days });
}
