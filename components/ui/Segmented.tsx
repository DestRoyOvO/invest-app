"use client";

import { useId, useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

import { PHONE_TARGET } from "./Button";
import { rovingIndex } from "./keys";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  /** Visible group label (also the accessible name). */
  label: string;
  /** Keep the label for screen readers only, e.g. inside a panel header. */
  hideLabel?: boolean;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * A single choice among two to four short options (radiogroup). One tab stop: arrows, Home and End move the choice.
 * Equal-width segments on a hairline grid; the chosen one gets an opaque panel and an accent underline. Segments are
 * 28px (sm) or 32px (md) on desktop and at least 40px tall below the sm breakpoint.
 */
export function Segmented<T extends string>({ label, hideLabel = false, value, options, onChange, size = "md", className }: SegmentedProps<T>) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = rovingIndex(event.key, index, options.length, "both");
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div id={id} className={hideLabel ? "sr-only" : "text-xs font-medium text-fg-2"}>
        {label}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="grid gap-px rounded-xs bg-line p-px"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option, index) => {
          const checked = index === selectedIndex && option.value === value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === selectedIndex ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "truncate px-2 text-xs transition-colors",
                size === "sm" ? "h-7" : "h-8",
                PHONE_TARGET,
                // Opaque background: a translucent accent over the hairline color fails contrast in the light theme.
                checked ? "bg-panel-2 font-medium text-fg shadow-[inset_0_-2px_0_var(--accent)]" : "bg-panel text-fg-2 hover:bg-hover hover:text-fg",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
