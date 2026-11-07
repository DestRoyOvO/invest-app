import { withTrueMinus } from "@/components/ui/Delta";
import { cn } from "@/lib/cn";
import { DASH, formatNumber, signOf } from "@/lib/format";
import type { Lang } from "@/types/api";

/** A signed money amount as text with a true minus, e.g. "+1,234.50" or "−12.00"; a dash when missing. */
export function signedMoneyText(value: number | null | undefined, lang: Lang, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return DASH;
  const sign = signOf(value);
  const text = formatNumber(Math.abs(value), digits, lang);
  return sign > 0 ? `+${text}` : sign < 0 ? withTrueMinus(`-${text}`) : text;
}

/** An amount of money (value, cost) in --fg with grouping and fixed decimals. */
export function Money({ value, lang, digits = 2, className }: { value: number | null | undefined; lang: Lang; digits?: number; className?: string }) {
  const missing = typeof value !== "number" || !Number.isFinite(value);
  return <span className={cn("num whitespace-nowrap", missing ? "text-fg-3" : "text-fg", className)}>{missing ? DASH : formatNumber(value, digits, lang)}</span>;
}

/** A P&L amount colored by direction (--up / --down follow the price convention) with an explicit sign. */
export function SignedMoney({ value, lang, digits = 2, className }: { value: number | null | undefined; lang: Lang; digits?: number; className?: string }) {
  const sign = signOf(value);
  const color = sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-fg-3";
  return <span className={cn("num whitespace-nowrap", color, className)}>{signedMoneyText(value, lang, digits)}</span>;
}
