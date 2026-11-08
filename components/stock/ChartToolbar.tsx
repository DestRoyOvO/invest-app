"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { rovingIndex } from "@/components/ui/keys";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import type { ChartRange } from "@/types/api";

import { CHART_STUDIES, type ChartSettings, type ChartStudy } from "./chart-settings";
import { RANGES } from "./chart-utils";

/**
 * The ten chart ranges as one radio group (one tab stop, arrows, Home and End). Compact caps like panel tabs on
 * desktop, 40px tall on phones, and the row scrolls sideways when the screen is narrower than the ranges.
 */
export function RangePicker({ value, onChange }: { value: ChartRange; onChange: (range: ChartRange) => void }) {
  const { t } = usePrefs();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(RANGES.indexOf(value), 0);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = rovingIndex(event.key, index, RANGES.length);
    if (next === null) return;
    event.preventDefault();
    onChange(RANGES[next]);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={t.chart.rangeLabel} className="no-scrollbar flex min-w-0 items-center overflow-x-auto">
      {RANGES.map((range, index) => {
        const checked = index === selected;
        return (
          <button
            key={range}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(range)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "h-8 shrink-0 border-b-2 px-2 text-xs font-medium tracking-[0.04em] whitespace-nowrap uppercase transition-colors focus-visible:outline-offset-[-2px] max-sm:h-10 max-sm:min-w-10 max-sm:px-1.5",
              checked ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
            )}
          >
            {t.stock.ranges[range]}
          </button>
        );
      })}
    </div>
  );
}

/** The studies popover: moving averages, Bollinger bands, the RSI pane, volume and the log scale, applied at once. */
export function StudiesMenu({ settings, onChange, disabled = false }: { settings: ChartSettings; onChange: (patch: Partial<ChartSettings>) => void; disabled?: boolean }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={buttonRef}
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        title={disabled ? t.chart.studiesHidden : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn("max-sm:h-10", open && "bg-hover text-fg")}
      >
        <SlidersHorizontal aria-hidden className="size-3.5" strokeWidth={1.75} />
        {t.chart.studies}
      </Button>
      {open ? (
        <div id={panelId} role="dialog" aria-label={t.chart.studiesTitle} className="absolute top-full right-0 z-40 mt-1 w-56 space-y-1 rounded-xs border border-line-2 bg-panel p-2 shadow-2xl">
          {CHART_STUDIES.map((study: ChartStudy) => (
            <Switch
              key={study}
              label={t.chart.study[study]}
              checked={settings[study]}
              onCheckedChange={(checked) => onChange({ [study]: checked })}
              className="flex w-full rounded-xs px-1.5 py-1.5 hover:bg-hover max-sm:min-h-10 max-sm:items-center"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
