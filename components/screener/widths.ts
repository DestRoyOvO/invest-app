// Column widths of the screener table and the fit of a column set to the table's width. Pure, so it can be tested.

import { NARROW_DROP_ORDER, type ColumnSetKey, type MetricKey } from "@/lib/screens";
import type { ScreenerUniverse } from "@/types/api";

/**
 * Column widths in rem, sized for the widest value and for the header with its sort arrow (the text, 24px of padding,
 * a 4px gap and the 12px arrow), as measured in English and Chinese. Every set fits a 1440px screen beside the nav and
 * the filter rail (widths.test.ts), which the ETF overview, the widest set, does with 1px to spare. So a few heads show
 * their whole text only while their column is not the sorted one: in Chinese 年初至今 (YTD, 8px short), 波动率 (Vol, 4px)
 * and 市盈率 (P/E, 12px), in English SYMBOL (5px); and a return of 100% or more loses its last character in the return
 * columns ("+104.5%" needs 79px of their 76). The name column has no width, so it takes what is left (at least
 * NAME_MIN_REM before the table scrolls sideways).
 */
export const WIDTHS: Readonly<Record<MetricKey, number | null>> = {
  symbol: 5,
  name: null,
  sector: 6,
  price: 5.25,
  chg: 5.25,
  cap: 6,
  assets: 5.75,
  // "费率" with the sort arrow needs 64px, a fee such as "0.95%" 63px.
  er: 4,
  pe: 4,
  fpe: 6.5,
  // A negative book value reaches "−191.2", and "市净率" with the sort arrow needs the same room.
  pb: 5,
  yield: 5,
  div: 5.25,
  exdiv: 6,
  rating: 7.5,
  earnings: 6.5,
  ytd: 5,
  r1m: 4.75,
  r3m: 4.75,
  r6m: 4.75,
  high: 7,
  ma50: 5.5,
  ma200: 6,
  rsi: 4,
  vol: 4.5,
  beta: 4.5,
  // Chinese compact amounts run longer than English ones: "7107.57万" needs 88px, "841.03M" 78px.
  dvol: 5.5,
  momPct: 7,
  revPct: 6.75,
  highPct: 7,
  volPct: 6.5,
  betaPct: 6.75,
};

export const NAME_MIN_REM = 6.5;
/** Fits the checkbox and the label gap inside the cell padding, so the truncating cell draws no ellipsis. */
export const SELECT_REM = 3;
export const STAR_REM = 3.25;
/** Room kept for the table's vertical scrollbar: app/globals.css asks for thin ones (10px in Chrome on Windows). */
export const SCROLLBAR_REM = 0.75;

/** Width at which the visible columns stop squeezing the name, for the table's minWidth from sm up. */
export function tableMinWidthRem(keys: readonly MetricKey[]): number {
  return keys.reduce((sum, key) => sum + (WIDTHS[key] ?? NAME_MIN_REM), SELECT_REM + STAR_REM);
}

/**
 * The columns of a set that fit a table `widthRem` wide: the set's lower-priority columns (NARROW_DROP_ORDER) go one by
 * one until the rest fits, or only the symbol, the name and the phone columns are left. A tablet, or a laptop with the
 * filter rail open, then shows fewer columns instead of hiding the last ones (the star among them) behind a sideways
 * scroll. Null (not measured yet) keeps the whole set.
 */
export function fitColumns(keys: readonly MetricKey[], universe: ScreenerUniverse, set: ColumnSetKey, widthRem: number | null): readonly MetricKey[] {
  if (widthRem === null) return keys;
  const available = widthRem - SCROLLBAR_REM;
  let visible = keys;
  for (const key of NARROW_DROP_ORDER[universe][set]) {
    if (tableMinWidthRem(visible) <= available) break;
    visible = visible.filter((k) => k !== key);
  }
  return visible;
}
