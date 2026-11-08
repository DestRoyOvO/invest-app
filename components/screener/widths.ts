// Column widths of the screener table and the fit of a column set to the table's width. Pure, so it can be tested.

import { NARROW_DROP_ORDER, type ColumnSetKey, type MetricKey } from "@/lib/screens";
import type { ScreenerUniverse } from "@/types/api";

/**
 * Column widths in rem, sized for the longest header with its sort arrow and the widest value. The name column has
 * none, so it takes what is left (at least NAME_MIN_REM before the table scrolls sideways).
 */
export const WIDTHS: Readonly<Record<MetricKey, number | null>> = {
  symbol: 5,
  name: null,
  sector: 6,
  price: 5.25,
  chg: 5.25,
  cap: 6,
  assets: 5.75,
  er: 4.5,
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
  dvol: 5.25,
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
/** Room kept for the table's vertical scrollbar: app/globals.css asks for thin ones (11px in Chrome on Windows). */
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
