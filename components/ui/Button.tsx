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

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one main action in a view; secondary: everything else; ghost: low-emphasis actions in dense rows. */
  variant?: Variant;
  size?: Size;
}

/** Text button. Disabled buttons stay readable (--fg-3 on --panel-2) instead of fading out. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
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
 * row actions stay easy to hit on a phone.
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
        size === "sm" ? "size-7 max-sm:size-10" : "size-8 max-sm:size-10",
        active ? "bg-accent-soft text-accent" : "text-fg-2 enabled:hover:bg-hover enabled:hover:text-fg",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
});
