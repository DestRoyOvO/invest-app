/**
 * Live canary for the unofficial Yahoo Finance contract.
 *
 * It calls the app's real getters (lib/server/yahoo.ts) for a stock, an index, an ETF and a cryptocurrency and checks
 * the mapped shapes the screens and the model rely on: a finite price, at least 200 daily bars over a year, a market
 * cap where one exists, a company profile and search results. Pull-request CI never calls Yahoo; this script runs on a
 * schedule (.github/workflows/canary.yml) and by hand, and prints how long every call took.
 *
 * Usage: npx tsx --conditions=react-server scripts/smoke-yahoo.ts
 * (the react-server condition resolves the "server-only" marker to its empty module outside Next.js)
 *
 * Exits with 0 when every check passes and 1 otherwise. About ten Yahoo requests, through the app's own client
 * (concurrency 4, the same timeouts).
 */

import { getChart, getQuotes, getSummary, searchNews, searchSymbols } from "../lib/server/yahoo";
import type { Quote } from "../types/api";

interface Target {
  symbol: string;
  /** Yahoo reports a market cap for this symbol (stocks and cryptocurrencies). */
  marketCap: boolean;
}

const TARGETS: readonly Target[] = [
  { symbol: "AAPL", marketCap: true },
  { symbol: "^GSPC", marketCap: false },
  { symbol: "SPY", marketCap: false },
  { symbol: "BTC-USD", marketCap: true },
];

const MIN_DAILY_BARS = 200;

interface Result {
  check: string;
  ok: boolean;
  detail: string;
  ms: number;
}

const results: Result[] = [];

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Runs one check, timing it; an exception counts as a failure with its message as the detail. */
async function check(name: string, run: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  const started = performance.now();
  let outcome: { ok: boolean; detail: string };
  try {
    outcome = await run();
  } catch (error) {
    outcome = { ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
  const ms = Math.round(performance.now() - started);
  results.push({ check: name, ms, ...outcome });
  console.log(`${outcome.ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} ${String(ms).padStart(6)} ms  ${outcome.detail}`);
}

async function main(): Promise<void> {
  console.log(`Yahoo contract canary, ${new Date().toISOString()}\n`);

  // One batched quote request for every target, as the market overview makes it.
  let quotes = new Map<string, Quote>();
  await check("quotes (one batch)", async () => {
    quotes = await getQuotes(TARGETS.map((target) => target.symbol));
    const missing = TARGETS.filter((target) => !quotes.has(target.symbol)).map((target) => target.symbol);
    return { ok: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : `${quotes.size} quotes` };
  });

  for (const target of TARGETS) {
    await check(`quote ${target.symbol}`, async () => {
      const quote = quotes.get(target.symbol);
      if (!quote) return { ok: false, detail: "no quote" };
      const problems: string[] = [];
      if (!isPositive(quote.price)) problems.push(`price ${quote.price}`);
      if (quote.marketState === null) problems.push("no market state");
      if (target.marketCap && !isPositive(quote.marketCap)) problems.push(`market cap ${quote.marketCap}`);
      const shown = `price ${quote.price} ${quote.currency ?? ""}, ${quote.marketState ?? "?"}${target.marketCap ? `, cap ${quote.marketCap}` : ""}`;
      return { ok: problems.length === 0, detail: problems.length ? problems.join("; ") : shown };
    });

    await check(`daily bars 1y ${target.symbol}`, async () => {
      const chart = await getChart(target.symbol, "1y");
      const bars = chart.bars;
      const ordered = bars.every((bar, i) => i === 0 || bar.t > bars[i - 1].t);
      const finite = bars.every((bar) => Number.isFinite(bar.c) && bar.c > 0);
      const ok = bars.length >= MIN_DAILY_BARS && ordered && finite;
      const last = bars.at(-1);
      const detail = `${bars.length} bars${ordered ? "" : ", out of order"}${finite ? "" : ", bad closes"}${last ? `, last ${new Date(last.t).toISOString().slice(0, 10)}` : ""}`;
      return { ok, detail };
    });
  }

  await check("summary AAPL", async () => {
    const summary = await getSummary("AAPL");
    if (!summary) return { ok: false, detail: "no summary" };
    const problems: string[] = [];
    if (!summary.profile.sector) problems.push("no sector");
    if (!isPositive(summary.stats.marketCap)) problems.push(`market cap ${summary.stats.marketCap}`);
    return { ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `${summary.profile.sector}, ${summary.profile.industry}` };
  });

  await check("symbol search AAPL", async () => {
    const found = await searchSymbols("AAPL");
    return { ok: found.some((result) => result.symbol === "AAPL"), detail: found.slice(0, 3).map((result) => result.symbol).join(", ") || "no results" };
  });

  await check("news search Apple", async () => {
    const news = await searchNews("Apple", 5);
    const valid = news.filter((item) => item.title && item.link.startsWith("http"));
    return { ok: valid.length > 0, detail: `${valid.length} headlines` };
  });

  const failed = results.filter((result) => !result.ok);
  const total = results.reduce((sum, result) => sum + result.ms, 0);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${total} ms.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((result) => result.check).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Canary crashed:", error);
  process.exitCode = 1;
});
