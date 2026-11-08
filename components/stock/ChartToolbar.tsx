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

interface StudiesPanelProps {
  settings: ChartSettings;
  onChange: (patch: Partial<ChartSettings>) => void;
  /**
   * Studies the symbol's data cannot draw, with the reason shown under the switch (volume for ^TNX or EURUSD=X). Their
   * switch is off and disabled; the saved setting stays for the next symbol.
   */
  unavailable?: Partial<Record<ChartStudy, string>>;
}

/**
 * The switches of the studies menu. The reason a study is unavailable is a line of its own under the switch, not the
 * switch's description, which the disabled switch dims along with its label; and it describes the whole group, since
 * Tab skips a disabled switch: screen readers announce it as focus enters the menu.
 */
export function StudiesPanel({ id, settings, onChange, unavailable }: StudiesPanelProps & { id: string }) {
  const { t } = usePrefs();
  const reasonId = (study: ChartStudy) => `${id}-${study}-reason`;
  const reasonIds = CHART_STUDIES.filter((study) => unavailable?.[study]).map(reasonId);
  return (
    <div
      id={id}
      role="group"
      aria-label={t.chart.studiesTitle}
      aria-describedby={reasonIds.length > 0 ? reasonIds.join(" ") : undefined}
      className="absolute top-full right-0 z-40 mt-1 w-56 space-y-1 rounded-xs border border-line-2 bg-panel p-2 shadow-2xl"
    >
      {CHART_STUDIES.map((study: ChartStudy) => {
        const reason = unavailable?.[study];
        const toggle = (
          <Switch
            key={study}
            label={t.chart.study[study]}
            checked={reason ? false : settings[study]}
            disabled={Boolean(reason)}
            onCheckedChange={(checked) => onChange({ [study]: checked })}
            className="flex w-full rounded-xs px-1.5 py-1.5 enabled:hover:bg-hover max-sm:min-h-10 max-sm:items-center"
          />
        );
        if (!reason) return toggle;
        // Under the label (the row's padding, the switch and the gap: 44px), at full contrast.
        return (
          <div key={study}>
            {toggle}
            <p id={reasonId(study)} className="-mt-1 pr-1.5 pb-1.5 pl-11 text-xs text-fg-3">
              {reason}
            </p>
          </div>
        );
      })}
    </div>
  );
}

interface StudiesMenuProps extends StudiesPanelProps {
  disabled?: boolean;
}

/**
 * The studies menu: moving averages, Bollinger bands, the RSI pane, volume and the log scale, applied at once. A
 * disclosure: the switches follow the button in tab order, and the menu closes on Escape (focus returns to the
 * button), on a click outside, or when focus moves on past it.
 */
export function StudiesMenu({ settings, onChange, disabled = false, unavailable }: StudiesMenuProps) {
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
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (open && next instanceof Node && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
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
      {open ? <StudiesPanel id={panelId} settings={settings} onChange={onChange} unavailable={unavailable} /> : null}
    </div>
  );
}
