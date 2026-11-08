// Sorting rules for DataTable, kept free of React so they can be tested.

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export type SortValue = number | string | boolean | null | undefined;

const collators = new Map<string, Intl.Collator>();

/** The collator for a locale (the runtime's own without one): Chinese names sort by pinyin under zh-CN. */
function collatorFor(locale: string | undefined): Intl.Collator {
  let collator = collators.get(locale ?? "");
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    collators.set(locale ?? "", collator);
  }
  return collator;
}

function isMissing(value: SortValue): value is null | undefined {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
}

/**
 * Compares two cell values in the given direction. Numbers compare numerically, strings in natural order ("A2" before
 * "A10"), booleans as false < true, and missing values (null, undefined, NaN) always sort last, in both directions,
 * so an empty P/E never tops a "lowest P/E" list. Strings collate in `locale`, the app language's (pinyin order in
 * Chinese), or in the runtime's own without one.
 */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection, locale?: string): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  let base: number;
  if (typeof a === "number" && typeof b === "number") base = a === b ? 0 : a < b ? -1 : 1;
  else if (typeof a === "boolean" && typeof b === "boolean") base = a === b ? 0 : a ? 1 : -1;
  else if (typeof a === "string" && typeof b === "string") base = collatorFor(locale).compare(a, b);
  // Mixed types: numbers before booleans before strings, so the order is still deterministic.
  else base = typeRank(a) - typeRank(b);
  return direction === "asc" ? base : -base;
}

function typeRank(value: number | string | boolean): number {
  return typeof value === "number" ? 0 : typeof value === "boolean" ? 1 : 2;
}

/**
 * Returns a sorted copy. Rows with equal values fall back to `tieBreak` (in its own ascending order, whatever the
 * direction) and then to their original order, so re-sorting live data never makes equal rows jump around.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  value: (row: Row) => SortValue,
  direction: SortDirection,
  tieBreak?: (a: Row, b: Row) => number,
  locale?: string,
): Row[] {
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => compareSortValues(a.key, b.key, direction, locale) || (tieBreak ? tieBreak(a.row, b.row) : 0) || a.index - b.index)
    .map((entry) => entry.row);
}

/** Sort state after a header click: the column's first direction, then the opposite one, then back to unsorted. */
export function nextSort(current: SortState | null, key: string, first: SortDirection): SortState | null {
  if (!current || current.key !== key) return { key, direction: first };
  if (current.direction === first) return { key, direction: first === "asc" ? "desc" : "asc" };
  return null;
}

/** The aria-sort value for a column header. */
export function ariaSort(current: SortState | null, key: string): "ascending" | "descending" | undefined {
  if (!current || current.key !== key) return undefined;
  return current.direction === "asc" ? "ascending" : "descending";
}
