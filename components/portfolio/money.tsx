import { cn } from "@/lib/cn";
import { DASH, displayedSign, formatNumber } from "@/lib/format";
import type { Lang } from "@/types/api";

import { signedMoneyText } from "./money-format";

/** An amount of money (value, cost) in --fg with grouping and fixed decimals. */
export function Money({ value, lang, digits = 2, className }: { value: number | null | undefined; lang: Lang; digits?: number; className?: string }) {
  const missing = typeof value !== "number" || !Number.isFinite(value);
  return <span className={cn("num whitespace-nowrap", missing ? "text-fg-3" : "text-fg", className)}>{missing ? DASH : formatNumber(value, digits, lang)}</span>;
}

/** A P&L amount colored by direction (--up / --down follow the price convention) with an explicit sign; 0.00 stays neutral. */
export function SignedMoney({ value, lang, digits = 2, className }: { value: number | null | undefined; lang: Lang; digits?: number; className?: string }) {
  const sign = displayedSign(value, digits);
  const color = sign > 0 ? "text-up" : sign < 0 ? "text-down" : "text-fg-3";
  return <span className={cn("num whitespace-nowrap", color, className)}>{signedMoneyText(value, lang, digits)}</span>;
}
