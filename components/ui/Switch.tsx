"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  /** A quieter second line, linked with aria-describedby. */
  description?: ReactNode;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * On/off setting that applies immediately (role="switch"). The whole row is the control. For choices that apply on
 * submit, use a Checkbox instead.
 */
export function Switch({ checked, onCheckedChange, label, description, hideLabel = false, disabled = false, className }: SwitchProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-description` : undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("group inline-flex items-start gap-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60", className)}
    >
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-xs border transition-colors",
          checked ? "border-accent bg-accent" : "border-input-border bg-input-bg group-enabled:group-hover:border-fg-3",
        )}
      >
        <span className={cn("absolute size-2.5 rounded-[1px] transition-transform", checked ? "translate-x-[0.875rem] bg-accent-fg" : "translate-x-[0.125rem] bg-fg-3")} />
      </span>
      <span className={hideLabel ? "sr-only" : "min-w-0"}>
        <span id={`${id}-label`} className="text-fg">
          {label}
        </span>
        {description ? (
          <span id={`${id}-description`} className="block text-xs text-fg-3">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
