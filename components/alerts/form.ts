// Pure helpers behind the alert editor, kept free of React so they can be tested.

import type { AlertKind, AlertRule } from "@/lib/alerts";

/**
 * Parses a number typed into a field: accepts a true minus (U+2212), a leading plus, grouping commas, spaces and a
 * trailing percent sign. Returns null for empty or unreadable text.
 */
export function parseNumberInput(text: string): number | null {
  const clean = text.replace(/\u2212/g, "-").replace(/[,\s%]/g, "").replace(/^\+/, "");
  if (!clean || !/^-?(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** The value a kind starts with when the investor switches to it and the field is empty. */
export const DEFAULT_VALUES: Record<AlertKind, string> = {
  above: "",
  below: "",
  day_move: "5",
  pnl_from_cost: "-10",
  earnings_within: "3",
  cross_ma200: "",
};

/** The value field after switching kinds: kept between the two price kinds, otherwise the new kind's default. */
export function valueAfterKindChange(from: AlertKind, to: AlertKind, current: string): string {
  const price = (kind: AlertKind) => kind === "above" || kind === "below";
  if (price(from) && price(to)) return current;
  return DEFAULT_VALUES[to];
}

/** The form fields for a rule being edited. */
export function formFromRule(rule: Pick<AlertRule, "symbol" | "kind" | "value" | "repeat" | "note">): { symbol: string; kind: AlertKind; value: string; repeat: AlertRule["repeat"]; note: string } {
  return { symbol: rule.symbol, kind: rule.kind, value: rule.value === null ? "" : String(rule.value), repeat: rule.repeat, note: rule.note };
}
