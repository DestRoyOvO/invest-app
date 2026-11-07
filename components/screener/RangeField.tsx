"use client";

import { useId, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { formatInputNumber, fromInput, metricUnit, parseNumberInput, toInput, type MetricKey, type NumericRange } from "@/lib/screens";

/** The text a bound shows: the raw value in typed units, or empty. */
function boundText(key: MetricKey, value: number | null): string {
  return value === null ? "" : formatInputNumber(toInput(metricUnit(key), value));
}

interface BoundInputProps {
  metric: MetricKey;
  value: number | null;
  label: string;
  placeholder: string;
  onCommit: (value: number | null) => void;
}

/**
 * One bound. Every keystroke that parses applies at once (filtering is local), an unfinished entry such as "-" waits
 * and is flagged on blur, and a value changed from outside (a preset, Clear all) replaces the text.
 */
function BoundInput({ metric, value, label, placeholder, onCommit }: BoundInputProps) {
  const { t } = usePrefs();
  const errorId = useId();
  const [text, setText] = useState(() => boundText(metric, value));
  const [synced, setSynced] = useState(value);
  const [invalid, setInvalid] = useState(false);

  if (value !== synced) {
    setSynced(value);
    const parsed = parseNumberInput(text);
    const current = parsed.kind === "number" ? fromInput(metricUnit(metric), parsed.value) : null;
    if (current !== value) {
      setText(boundText(metric, value));
      setInvalid(false);
    }
  }

  const change = (next: string) => {
    setText(next);
    const parsed = parseNumberInput(next);
    if (parsed.kind === "invalid") return;
    setInvalid(false);
    onCommit(parsed.kind === "empty" ? null : fromInput(metricUnit(metric), parsed.value));
  };

  return (
    <div className="min-w-0 space-y-1">
      <Input
        size="sm"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        placeholder={placeholder}
        value={text}
        onChange={(event) => change(event.target.value)}
        onBlur={() => setInvalid(parseNumberInput(text).kind === "invalid")}
        className="num max-sm:h-10 max-sm:text-sm"
      />
      {invalid ? (
        <p id={errorId} className="text-xs text-danger">
          {t.screener.filters.invalid}
        </p>
      ) : null}
    </div>
  );
}

interface RangeFieldProps {
  metric: MetricKey;
  range: NumericRange | undefined;
  onChange: (range: NumericRange) => void;
}

/** A min/max pair for one metric, labelled with the unit it takes ("Dividend yield %", "Market cap $B"). */
export function RangeField({ metric, range, onChange }: RangeFieldProps) {
  const { t } = usePrefs();
  const id = useId();
  const name = t.screener.metricNames[metric];
  const unit = t.screener.filters.units[metricUnit(metric)];
  const min = range?.min ?? null;
  const max = range?.max ?? null;
  const active = min !== null || max !== null;
  return (
    <div role="group" aria-labelledby={id} className="space-y-1">
      <div id={id} className={cn("flex items-baseline justify-between gap-2 text-xs", active ? "font-medium text-fg" : "text-fg-2")}>
        <span className="truncate">{name}</span>
        {unit ? <span className="num shrink-0 font-normal text-fg-3">{unit}</span> : null}
      </div>
      <div className="grid grid-cols-2 items-start gap-1.5">
        <BoundInput
          metric={metric}
          value={min}
          label={tpl(t.screener.filters.minLabel, { metric: name })}
          placeholder={t.screener.filters.min}
          onCommit={(value) => onChange({ min: value, max })}
        />
        <BoundInput
          metric={metric}
          value={max}
          label={tpl(t.screener.filters.maxLabel, { metric: name })}
          placeholder={t.screener.filters.max}
          onCommit={(value) => onChange({ min, max: value })}
        />
      </div>
    </div>
  );
}
