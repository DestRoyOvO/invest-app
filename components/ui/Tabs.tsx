"use client";

import { useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

/** Compact terminal-style tabs (role=tablist) with arrow-key navigation. */
export function Tabs<T extends string>({ value, onChange, options, label, className, size = "sm" }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
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
              "num -mb-px border-b-2 uppercase tracking-wide transition-colors",
              size === "sm" ? "h-9 px-2 text-xs" : "h-10 px-3 text-xs",
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
