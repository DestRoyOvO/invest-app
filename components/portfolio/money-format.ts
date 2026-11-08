// Pure formatting for money amounts, kept free of React so it can be tested.

import { withTrueMinus } from "@/components/ui/delta-utils";
import { DASH, formatNumber } from "@/lib/format";
import type { Lang } from "@/types/api";

const currencyDigitCache = new Map<string, number>();

/**
 * Decimals an amount in this currency is shown with: the currency's minor unit (2 for USD and EUR, 0 for JPY and KRW),
 * 2 when unknown. Yahoo's minor-unit codes ("GBp" pence) keep 2.
 */
export function currencyDigits(currency: string | null | undefined): number {
  if (!currency) return 2;
  let digits = currencyDigitCache.get(currency);
  if (digits === undefined) {
    try {
      digits = currency === currency.toUpperCase() ? (new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2) : 2;
    } catch {
      digits = 2;
    }
    currencyDigitCache.set(currency, digits);
  }
  return digits;
}

/** Sign of an amount as shown with `digits` decimals: 0 when it rounds to zero, so −0.004 never shows as "−0.00". */
export function displayedSign(value: number | null | undefined, digits = 2): -1 | 0 | 1 {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(digits));
  return rounded > 0 ? 1 : rounded < 0 ? -1 : 0;
}

/** A signed money amount as text with a true minus, e.g. "+1,234.50" or "−12.00"; a dash when missing. */
export function signedMoneyText(value: number | null | undefined, lang: Lang, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return DASH;
  const sign = displayedSign(value, digits);
  const text = formatNumber(Math.abs(value), digits, lang);
  return sign > 0 ? `+${text}` : sign < 0 ? withTrueMinus(`-${text}`) : text;
}
