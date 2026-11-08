"use client";

import { Plus, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { IconButton } from "@/components/ui/Button";
import { useSymbolSearch } from "@/hooks/useApi";
import { useDebounced } from "@/hooks/useLocalValue";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { hasCjk, searchChineseNames } from "@/lib/names-zh";
import { normalizeSymbol } from "@/lib/symbols";

import { MAX_COMPARE, type SeriesSlot } from "./chart-utils";

// Static class names so Tailwind sees them.
const SOLID: Record<SeriesSlot["token"], string> = { 1: "bg-series-1", 2: "bg-series-2", 3: "bg-series-3", 4: "bg-series-4" };
const DASHED: Record<SeriesSlot["token"], string> = { 1: "border-series-1", 2: "border-series-2", 3: "border-series-3", 4: "border-series-4" };

/** Line key next to a series name: the quote's own line in --fg, a comparison in its series color (dashed when the line is). */
export function SeriesKey({ slot, main = false }: { slot?: SeriesSlot; main?: boolean }) {
  if (main || !slot) return <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 bg-fg" />;
  if (slot.dashed) return <span aria-hidden className={cn("inline-block w-3 shrink-0 border-t-2 border-dashed", DASHED[slot.token])} />;
  return <span aria-hidden className={cn("inline-block h-0.5 w-3 shrink-0", SOLID[slot.token])} />;
}

interface CompareBarProps {
  symbol: string;
  compare: readonly string[];
  /** Colors of the comparison lines, in order (see compareSlots). */
  slots: readonly SeriesSlot[];
  /** Default chips (SPY, the sector ETF) offered when they are not on the chart yet. */
  suggestions: readonly string[];
  onChange: (symbols: string[]) => void;
}

/** Comparison overlays: active chips with a remove button, one-click defaults and a symbol search (Chinese names too). */
export function CompareBar({ symbol, compare, slots, suggestions, onChange }: CompareBarProps) {
  const { t } = usePrefs();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();
  const query = useDebounced(value.trim(), 200);
  const { data } = useSymbolSearch(query);
  const full = compare.length >= MAX_COMPARE;

  const results = value.trim()
    ? (hasCjk(value) ? searchChineseNames(value, 6).map((r) => ({ symbol: r.symbol, name: r.name })) : (data?.results ?? []).slice(0, 6))
    : [];
  const options = results.filter((r) => r.symbol !== symbol && !compare.includes(r.symbol));

  const add = (input: string) => {
    const next = normalizeSymbol(input);
    if (!next || next === symbol || compare.includes(next) || full) return;
    onChange([...compare, next]);
    setValue("");
    setActive(-1);
    setAdding(false);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    add(active >= 0 ? (options[active]?.symbol ?? value) : value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setAdding(false);
      setValue("");
      return;
    }
    if (options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    }
  };

  const chipClass = "mono inline-flex h-7 items-center gap-1.5 rounded-xs border px-2 text-xs font-medium max-sm:h-10";
  const offered = suggestions.filter((s, i) => s !== symbol && !compare.includes(s) && suggestions.indexOf(s) === i);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="col-head">{t.chart.compare}</span>
      {compare.map((item, slot) => (
        <span key={item} className={cn(chipClass, "border-line-2 pr-0.5 text-fg")}>
          <SeriesKey slot={slots[slot]} />
          {item}
          <IconButton size="sm" label={tpl(t.chart.remove, { symbol: item })} icon={<X className="size-3" strokeWidth={2} />} onClick={() => onChange(compare.filter((s) => s !== item))} className="size-6 max-sm:size-9" />
        </span>
      ))}
      {!full
        ? offered.map((item) => (
            <button key={item} type="button" onClick={() => add(item)} title={tpl(t.chart.compareWith, { symbol: item })} className={cn(chipClass, "border-dashed border-line-2 text-fg-2 transition-colors hover:border-accent hover:text-accent")}>
              <Plus aria-hidden className="size-3" strokeWidth={2} />
              {item}
            </button>
          ))
        : null}
      {full ? (
        <span className="text-micro text-fg-3">{tpl(t.chart.full, { n: MAX_COMPARE })}</span>
      ) : adding ? (
        <form onSubmit={onSubmit} className="relative">
          <label htmlFor={inputId} className="sr-only">
            {t.chart.addSymbol}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => window.setTimeout(() => !value.trim() && setAdding(false), 150)}
            placeholder={t.chart.addPlaceholder}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            className="mono h-7 w-32 rounded-xs border border-input-border bg-input-bg px-2 text-xs text-fg uppercase placeholder:normal-case placeholder:text-fg-3 focus:border-accent focus:outline-none max-sm:h-10"
          />
          {options.length > 0 ? (
            <ul id={listId} role="listbox" className="absolute top-full left-0 z-40 mt-1 w-64 rounded-xs border border-line-2 bg-panel py-1 shadow-2xl">
              {options.map((option, i) => (
                <li
                  key={option.symbol}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add(option.symbol);
                  }}
                  className={cn("flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs", i === active ? "bg-hover text-fg" : "text-fg-2")}
                >
                  <span className="mono w-20 shrink-0 font-medium text-fg">{option.symbol}</span>
                  <span className="min-w-0 truncate">{option.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={cn(chipClass, "border-transparent text-fg-3 transition-colors hover:text-fg")}>
          <Plus aria-hidden className="size-3" strokeWidth={2} />
          {t.chart.addPlaceholder}
        </button>
      )}
    </div>
  );
}
