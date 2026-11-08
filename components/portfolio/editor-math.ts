// The position editor's arithmetic, kept free of React so it can be tested: setting a position, adding shares at a
// price (weighted average cost), and reducing it (average cost unchanged, realized P&L reported).

export type EditorMode = "edit" | "add" | "reduce";

export interface PositionDraft {
  shares: number;
  /** Average cost per share. */
  cost: number;
}

/**
 * Parses a typed number such as "1,234.5", " 12 " or "1 200"; null when empty or not a plain decimal number.
 * Commas (also the full-width one) and spaces are treated as thousands separators.
 */
export function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/[,，\s]/g, "").replace(/^\+/, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export type FieldError = "shares" | "cost" | "price" | "tooMany";

export interface EditorInput {
  mode: EditorMode;
  /** The stored position, or null for a new one. */
  current: PositionDraft | null;
  /** edit: total shares; add: shares bought; reduce: shares sold. */
  shares: string;
  /** edit: average cost; add: price paid; reduce: sale price. */
  price: string;
}

export interface EditorResult {
  errors: { shares?: FieldError; price?: FieldError };
  valid: boolean;
  /** The position after the change; null when the input is invalid or the change sells every share. */
  next: PositionDraft | null;
  /** The change sells every share, so the position goes away. */
  closes: boolean;
  /** Reduce only: shares sold x (sale price - average cost). */
  realized: number | null;
}

/** Floating-point noise below this is not a share. */
const EPSILON = 1e-9;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** The position that a change would produce, with per-field errors. */
export function applyChange({ mode, current, shares: sharesText, price: priceText }: EditorInput): EditorResult {
  const shares = parseDecimal(sharesText);
  const price = parseDecimal(priceText);
  const effective: EditorMode = current ? mode : "edit";
  const errors: EditorResult["errors"] = {};
  if (shares === null || !(shares > 0)) errors.shares = "shares";
  if (price === null || !(price > 0)) errors.price = effective === "edit" ? "cost" : "price";
  if (effective === "reduce" && current && shares !== null && shares > current.shares + EPSILON) errors.shares = "tooMany";
  const valid = !errors.shares && !errors.price;
  if (!valid || shares === null || price === null) return { errors, valid: false, next: null, closes: false, realized: null };

  if (effective === "edit" || !current) {
    return { errors, valid, next: { shares: round(shares, 8), cost: round(price, 6) }, closes: false, realized: null };
  }
  if (effective === "add") {
    const total = current.shares + shares;
    const cost = (current.shares * current.cost + shares * price) / total;
    return { errors, valid, next: { shares: round(total, 8), cost: round(cost, 6) }, closes: false, realized: null };
  }
  const remaining = current.shares - shares;
  const closes = remaining <= EPSILON;
  return {
    errors,
    valid,
    next: closes ? null : { shares: round(remaining, 8), cost: current.cost },
    closes,
    realized: shares * (price - current.cost),
  };
}

export interface PositionPreview {
  value: number;
  pnl: number;
  pnlPct: number | null;
}

/** Value and unrealized P&L of a position at a price; null without a position or a usable price. */
export function previewAt(position: PositionDraft | null, price: number | null | undefined): PositionPreview | null {
  if (!position || typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  const value = position.shares * price;
  const basis = position.shares * position.cost;
  return { value, pnl: value - basis, pnlPct: basis > 0 ? (value - basis) / basis : null };
}
