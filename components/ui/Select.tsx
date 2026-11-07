"use client";

import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { controlClass, useFieldControl } from "./Field";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "sm" | "md";
  /** Classes for the wrapper (width, margins); the select fills it. */
  className?: string;
}

/**
 * Styled native select: the platform picker (best on phones and for screen readers) with the input look and a chevron.
 * Inside a Field it is labelled and described automatically.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ size = "md", className, children, ...props }, ref) {
  const wiring = useFieldControl(props);
  return (
    <span className={cn("relative inline-flex min-w-0", className)}>
      <select
        ref={ref}
        {...props}
        {...wiring}
        className={cn(controlClass, "w-full min-w-0 appearance-none pr-7", size === "sm" ? "h-7 pl-2 text-xs" : "h-8 pl-2.5 text-sm")}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-fg-3" strokeWidth={1.75} />
    </span>
  );
});
