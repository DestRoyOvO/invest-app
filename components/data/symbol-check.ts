// Checks imported symbols against live quotes (/api/quotes, 50 symbols per request, two requests at a time) and looks
// up suggestions for the symbols Yahoo does not know (/api/search, or the local Chinese name table for Chinese text,
// which Yahoo's search cannot read). The fetcher is injectable for tests.

import { fetchJson, symbolsParam } from "@/lib/api-client";
import { hasCjk, searchChineseNames } from "@/lib/names-zh";
import type { QuotesResponse, SearchResponse } from "@/types/api";

export interface SymbolInfo {
  name: string;
  currency: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  quoteType: string | null;
}

export type SymbolCheck = { status: "found"; info: SymbolInfo } | { status: "missing"; suggestions: string[] } | { status: "failed" };

export type Fetcher = <T>(url: string) => Promise<T>;

const QUOTE_CHUNK = 50;
/** Suggestion lookups per check, to keep a long list of typos from sending dozens of searches. */
const MAX_LOOKUPS = 8;
const MAX_SUGGESTIONS = 3;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Quotes for any number of symbols. Rejects when a request fails. */
export async function fetchQuoteInfo(symbols: readonly string[], fetcher: Fetcher = fetchJson): Promise<{ found: Map<string, SymbolInfo>; missing: string[] }> {
  const unique = [...new Set(symbols)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += QUOTE_CHUNK) chunks.push(unique.slice(i, i + QUOTE_CHUNK));
  const responses = await mapLimit(chunks, 2, (chunk) => fetcher<QuotesResponse>(`/api/quotes?symbols=${symbolsParam(chunk)}`));
  const found = new Map<string, SymbolInfo>();
  for (const response of responses) {
    for (const quote of response.quotes) {
      found.set(quote.symbol.toUpperCase(), {
        name: quote.name,
        currency: quote.currency,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        quoteType: quote.quoteType,
      });
    }
  }
  return { found, missing: unique.filter((symbol) => !found.has(symbol)) };
}

/** Up to three symbols that match any of the queries (the symbol as written, then the name from the file). */
export async function suggestSymbols(queries: readonly string[], exclude: string, fetcher: Fetcher = fetchJson): Promise<string[]> {
  const out: string[] = [];
  for (const query of queries) {
    const q = query.trim().slice(0, 40);
    if (!q) continue;
    let symbols: string[];
    if (hasCjk(q)) {
      symbols = searchChineseNames(q, MAX_SUGGESTIONS).map((match) => match.symbol);
    } else {
      try {
        symbols = (await fetcher<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`)).results.map((result) => result.symbol);
      } catch {
        symbols = [];
      }
    }
    for (const symbol of symbols) if (symbol !== exclude && !out.includes(symbol)) out.push(symbol);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

/**
 * Checks symbols: found (with the quote's name and currency), missing (with suggestions for the first few), or failed
 * for every symbol when the quotes could not be loaded at all.
 */
export async function checkSymbols(symbols: readonly string[], queriesOf: (symbol: string) => string[], fetcher: Fetcher = fetchJson): Promise<Map<string, SymbolCheck>> {
  const result = new Map<string, SymbolCheck>();
  let quotes: Awaited<ReturnType<typeof fetchQuoteInfo>>;
  try {
    quotes = await fetchQuoteInfo(symbols, fetcher);
  } catch {
    for (const symbol of symbols) result.set(symbol, { status: "failed" });
    return result;
  }
  for (const symbol of symbols) {
    const info = quotes.found.get(symbol);
    if (info) result.set(symbol, { status: "found", info });
  }
  const lookups = quotes.missing.slice(0, MAX_LOOKUPS);
  const suggestions = await mapLimit(lookups, 2, (symbol) => suggestSymbols(queriesOf(symbol), symbol, fetcher));
  quotes.missing.forEach((symbol, index) => result.set(symbol, { status: "missing", suggestions: suggestions[index] ?? [] }));
  return result;
}
