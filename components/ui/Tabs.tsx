"use client";

import { useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

import { PHONE_TARGET } from "./Button";
import { rovingIndex } from "./keys";

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Compact terminal-style tabs (role=tablist) with arrow-key, Home and End navigation. Sans 500, 12px caps. 36px (sm)
 * or 40px (md) tall on desktop, at least 40px below the sm breakpoint.
 */
export function Tabs<T extends string>({ value, onChange, options, label, className, size = "sm" }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = rovingIndex(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cn("flex items-center", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "-mb-px border-b-2 text-xs font-medium tracking-[0.04em] whitespace-nowrap uppercase transition-colors",
              size === "sm" ? "h-9 px-2" : "h-10 px-3",
              PHONE_TARGET,
              selected ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
