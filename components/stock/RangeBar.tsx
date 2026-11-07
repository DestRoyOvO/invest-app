import { formatPrice } from "@/lib/format";
import type { Lang } from "@/types/api";

/** Low–high range with a marker at the current value (e.g. day range, 52-week range). */
export function RangeBar({ low, high, value, lang }: { low: number | null; high: number | null; value: number | null; lang: Lang }) {
  const valid = low !== null && high !== null && value !== null && high > low;
  const position = valid ? Math.min(Math.max(((value - low) / (high - low)) * 100, 0), 100) : null;
  return (
    <div className="min-w-0">
      <div className="relative my-1 h-1 bg-line-2">
        {position !== null ? <span aria-hidden className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-fg" style={{ left: `${position}%` }} /> : null}
      </div>
      <div className="num flex justify-between gap-2 text-xs text-fg-3">
        <span>{formatPrice(low, lang)}</span>
        <span>{formatPrice(high, lang)}</span>
      </div>
    </div>
  );
}
