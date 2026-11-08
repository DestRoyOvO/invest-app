import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  // A disabled primary becomes a quiet gray button, not a muddy half-transparent amber.
  primary: "border border-transparent bg-accent text-accent-fg enabled:hover:brightness-110 disabled:border-line-2 disabled:bg-panel-2 disabled:text-fg-3",
  secondary: "border border-line-2 bg-panel-2 text-fg enabled:hover:bg-hover disabled:text-fg-3",
  ghost: "border border-transparent text-fg-2 enabled:hover:bg-hover enabled:hover:text-fg disabled:text-fg-3",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 gap-1.5 px-2 text-xs",
  md: "h-8 gap-2 px-3 text-sm",
};

/**
 * The 40px phone touch target the controls share (Button, Segmented, Select, Tabs, Input): a minimum height below the
 * sm breakpoint, so desktop sizes stay as they are and a taller control is never shrunk.
 */
export const PHONE_TARGET = "max-sm:min-h-10";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one main action in a view; secondary: everything else; ghost: low-emphasis actions in dense rows. */
  variant?: Variant;
  size?: Size;
  /**
   * Grows to a 40px touch target below sm (default). Turn it off only inside a container that cannot fit 40px, such as
   * the 32px ticker strip.
   */
  touchTarget?: boolean;
}

/**
 * Text button: 28px (sm) or 32px (md) on desktop and at least 40px tall below the sm breakpoint. Disabled buttons stay
 * readable (--fg-3 on --panel-2) instead of fading out.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", touchTarget = true, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xs font-medium whitespace-nowrap transition-colors",
        VARIANTS[variant],
        SIZES[size],
        touchTarget && PHONE_TARGET,
        className,
      )}
      {...props}
    />
  );
});

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name, also shown as a tooltip. */
  label: string;
  icon: ReactNode;
  size?: Size;
  /** Pressed or open state (a menu that is open, a toggle that is on). */
  active?: boolean;
}

/**
 * Square icon button: 28px (sm) or 32px (md) on desktop, and a 40px touch target below the sm breakpoint so adjacent
 * row actions stay easy to hit on a phone. In the compact density sm is 24px from sm up, so compact table rows with
 * actions stay about as tall as the rows without.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", active = false, className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xs border border-transparent transition-colors disabled:text-fg-3",
        size === "sm" ? "size-7 max-sm:size-10 sm:compact:size-6" : "size-8 max-sm:size-10",
        active ? "bg-accent-soft text-accent" : "text-fg-2 enabled:hover:bg-hover enabled:hover:text-fg",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
});
