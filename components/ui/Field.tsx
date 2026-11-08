"use client";

import { createContext, forwardRef, useContext, useId, type AriaAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { PHONE_TARGET } from "./Button";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Wiring a control picks up from the surrounding Field: its id, aria-describedby and aria-invalid. */
export function useFieldControl(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: AriaAttributes["aria-invalid"] }) {
  const field = useContext(FieldContext);
  const describedBy = [field?.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  const invalid = props["aria-invalid"] === true || props["aria-invalid"] === "true" || field?.invalid === true;
  return { id: props.id ?? field?.id, "aria-describedby": describedBy, "aria-invalid": invalid || undefined };
}

/** Shared look of text-like controls: --input-bg with an --input-border hairline (at least 3:1 against the panel). */
export const controlClass =
  "rounded-xs border border-input-border bg-input-bg text-fg placeholder:text-fg-3 transition-colors hover:border-fg-3 focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-60";

interface FieldProps {
  label: ReactNode;
  /** Help text under the control, linked with aria-describedby. */
  hint?: ReactNode;
  /** Error text; marks the control invalid and replaces nothing else, so the hint stays visible. */
  error?: ReactNode;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  id?: string;
  className?: string;
  /** One control: Input, Textarea or Select (they read the field wiring automatically). */
  children: ReactNode;
}

/** Label, control, hint and error as one unit. The control gets the id, aria-describedby and aria-invalid. */
export function Field({ label, hint, error, hideLabel = false, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `${autoId}-control`;
  const hintId = hint ? `${autoId}-hint` : undefined;
  const errorId = error ? `${autoId}-error` : undefined;
  const value: FieldContextValue = {
    id: controlId,
    describedBy: [hintId, errorId].filter(Boolean).join(" ") || undefined,
    invalid: Boolean(error),
  };
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={controlId} className={hideLabel ? "sr-only" : "block text-xs font-medium text-fg-2"}>
        {label}
      </label>
      <FieldContext value={value}>{children}</FieldContext>
      {hint ? (
        <p id={hintId} className="text-xs text-fg-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type ControlSize = "sm" | "md";

const INPUT_SIZES: Record<ControlSize, string> = { sm: "h-7 px-2 text-xs", md: "h-8 px-2.5 text-sm" };

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: ControlSize;
}

/**
 * Text input. Full width by default; inside a Field it is labelled and described automatically. 28px (sm) or 32px (md)
 * on desktop, at least 40px tall below the sm breakpoint.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = "md", className, ...props }, ref) {
  const wiring = useFieldControl(props);
  return <input ref={ref} {...props} {...wiring} className={cn(controlClass, "w-full min-w-0", INPUT_SIZES[size], PHONE_TARGET, className)} />;
});

/** Multi-line text input with the same look; resizes vertically only. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  const wiring = useFieldControl(props);
  return <textarea ref={ref} {...props} {...wiring} className={cn(controlClass, "block min-h-20 w-full resize-y px-2.5 py-2 text-sm leading-relaxed", className)} />;
});
