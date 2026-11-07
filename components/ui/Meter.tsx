import { cn } from "@/lib/cn";

import { toPercent } from "./glyphs";

interface MeterProps {
  /** 0-100, e.g. a percentile in the universe. Null draws an empty track. */
  value: number | null | undefined;
  /** Optional accent marker on the same 0-100 scale, e.g. the current reading or a comparison. */
  marker?: number | null;
  /** Accessible name, e.g. "Momentum percentile". */
  label: string;
  /** Spoken value, e.g. "72nd percentile"; defaults to the number. */
  valueText?: string;
  className?: string;
}

/**
 * Neutral 0-100 bar for percentiles and readings: a --fg-3 fill on a --line-2 track, a midline at 50 and an optional
 * accent marker. Never red or green: a percentile is not a gain or a loss.
 */
export function Meter({ value, marker, label, valueText, className }: MeterProps) {
  const fill = toPercent(value);
  const mark = toPercent(marker);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fill === null ? undefined : Math.round(fill)}
      aria-valuetext={valueText}
      className={cn("relative h-1.5 w-full min-w-12 bg-line-2", className)}
    >
      {fill !== null ? <span className="absolute inset-y-0 left-0 bg-fg-3" style={{ width: `${fill}%` }} /> : null}
      <span aria-hidden className="absolute -inset-y-0.5 left-1/2 w-px -translate-x-1/2 bg-fg-2" />
      {mark !== null ? <span aria-hidden className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-accent" style={{ left: `${mark}%` }} /> : null}
    </div>
  );
}
