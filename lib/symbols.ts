// Ticker validation shared by the client and the server.
// Accepts Yahoo-style symbols such as AAPL, BRK-B, ^GSPC, GC=F, BTC-USD, DX-Y.NYB and 0700.HK.

const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/;

/** Uppercases and trims the input; returns null if it is not a plausible Yahoo symbol. */
export function normalizeSymbol(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const symbol = input.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export interface ParsedSymbolList {
  /** Valid, normalized, de-duplicated symbols in input order. */
  symbols: string[];
  /** Entries that are not plausible symbols (truncated for safe echoing). */
  invalid: string[];
  /** True when more than `max` valid symbols were supplied. */
  tooMany: boolean;
}

/** Parses a comma-separated list such as "aapl, MSFT,brk-b". */
export function parseSymbolList(input: string | null | undefined, max: number): ParsedSymbolList {
  const symbols: string[] = [];
  const invalid: string[] = [];
  if (!input) return { symbols, invalid, tooMany: false };
  for (const part of input.split(",")) {
    if (!part.trim()) continue;
    const symbol = normalizeSymbol(part);
    if (!symbol) {
      if (invalid.length < 5) invalid.push(part.trim().slice(0, 20));
      continue;
    }
    if (!symbols.includes(symbol)) symbols.push(symbol);
  }
  return { symbols: symbols.slice(0, max), invalid, tooMany: symbols.length > max };
}
