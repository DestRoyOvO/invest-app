import { cn } from "@/lib/cn";

/**
 * A function code in the amber mono chip of panel headers (PanelCode), for lists where the code is part of the item's
 * name (the command bar, the More sheet, /help). Unlike PanelCode it is read by screen readers unless `decorative`.
 */
export function CodeChip({ code, decorative = false, className }: { code: string; decorative?: boolean; className?: string }) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn(
        "mono inline-flex h-[1.125rem] min-w-9 shrink-0 items-center justify-center rounded-xs border border-accent/50 px-1 text-[0.6875rem] leading-none font-semibold text-accent",
        className,
      )}
    >
      {code}
    </span>
  );
}
