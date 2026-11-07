"use client";

import { Check, Minus } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: ReactNode;
  /** A quieter second line under the label. */
  description?: ReactNode;
  /** Mixed state, e.g. "some rows selected". */
  indeterminate?: boolean;
}

/** Native checkbox with the input look (16px box, --input-border) and a clickable label. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, indeterminate = false, className, ...props }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cn("inline-flex cursor-pointer items-start gap-2 text-sm text-fg-2 has-disabled:cursor-not-allowed has-disabled:opacity-60", className)}>
      <span className="relative mt-0.5 inline-flex size-4 shrink-0">
        <input
          ref={inputRef}
          type="checkbox"
          {...props}
          className="peer size-4 cursor-[inherit] appearance-none rounded-xs border border-input-border bg-input-bg transition-colors checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent"
        />
        <Check aria-hidden className="pointer-events-none absolute inset-0 m-auto size-3 text-accent-fg opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0" strokeWidth={3} />
        <Minus aria-hidden className="pointer-events-none absolute inset-0 m-auto size-3 text-accent-fg opacity-0 peer-indeterminate:opacity-100" strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="text-fg">{label}</span>
        {description ? <span className="block text-xs text-fg-3">{description}</span> : null}
      </span>
    </label>
  );
});
