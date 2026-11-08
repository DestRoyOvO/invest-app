"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";
import type { Messages } from "@/lib/i18n/messages";
import type { Lang } from "@/types/api";

import { toPercent } from "./glyphs";

interface MeterProps {
  /** 0-100, e.g. a percentile in the universe. Null (or not a number) draws an empty track that says there is no value. */
  value: number | null | undefined;
  /** Optional accent marker on the same 0-100 scale, e.g. the current reading or a comparison. */
  marker?: number | null;
  /** Accessible name, e.g. "Momentum percentile". */
  label: string;
  /** Spoken value, e.g. "72nd percentile"; defaults to the number. Not used without a value. */
  valueText?: string;
  className?: string;
}

/** The name of a meter without a value, e.g. "Volatility percentile: Data unavailable" ("波动率百分位：暂无数据"). */
export function emptyMeterLabel(label: string, t: Messages, lang: Lang): string {
  return `${label}${lang === "zh" ? "：" : ": "}${t.common.dataUnavailable}`;
}

/**
 * Neutral 0-100 bar for percentiles and readings: a --fg-3 fill on a --line-2 track, a midline at 50 and an optional
 * accent marker. Never red or green: a percentile is not a gain or a loss. The marker has a 1px --panel halo, so it
 * stays visible where it sits on the fill (accent on --fg-3 is about 1.1:1 in the light theme).
 *
 * Without a value there is nothing to measure, and a meter must have a current value (aria-valuenow), so the empty
 * track is an image named "<label>: Data unavailable" in the reader's language instead.
 */
export function Meter({ value, marker, label, valueText, className }: MeterProps) {
  const { t, lang } = usePrefs();
  const fill = toPercent(value);
  const mark = toPercent(marker);
  const track = cn("relative h-1.5 w-full min-w-12 bg-line-2", className);
  const guides = (
    <>
      <span aria-hidden className="absolute -inset-y-0.5 left-1/2 w-px -translate-x-1/2 bg-fg-2" />
      {mark !== null ? (
        <span aria-hidden className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-accent shadow-[0_0_0_1px_var(--panel)]" style={{ left: `${mark}%` }} />
      ) : null}
    </>
  );
  if (fill === null) {
    return (
      <div role="img" aria-label={emptyMeterLabel(label, t, lang)} className={track}>
        {guides}
      </div>
    );
  }
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill)} aria-valuetext={valueText} className={track}>
      <span className="absolute inset-y-0 left-0 bg-fg-3" style={{ width: `${fill}%` }} />
      {guides}
    </div>
  );
}
