import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 border border-transparent",
  secondary: "border border-line-2 bg-panel-2 text-fg hover:bg-hover",
  ghost: "border border-transparent text-fg-2 hover:bg-hover hover:text-fg",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 gap-1.5 px-2 text-xs",
  md: "h-8 gap-2 px-3 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50",
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
  active?: boolean;
}

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
        "inline-flex shrink-0 items-center justify-center rounded-xs border border-transparent transition-colors disabled:opacity-50",
        size === "sm" ? "size-7" : "size-8",
        active ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-hover hover:text-fg",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
});
