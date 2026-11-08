import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "@/components/ui/DataTable";
import { parseCsv } from "@/lib/csv";
import { MESSAGES } from "@/lib/i18n/messages";
import { appliesTo, COLUMN_SET_KEYS, columnsFor, METRIC_KEYS, sortScreenRows, toCsv, type ColumnSetKey, type SortState } from "@/lib/screens";
import type { Lang, ScreenerUniverse } from "@/types/api";
import type { ScreenRow } from "@/types/screener";

import { screenColumns } from "./columns";

// The CSV export is a copy of the results table: the same rows, in the order the table shows them, named as the table
// names them. The table here is rendered as ScreenerTab renders it (rows from sortScreenRows, which DataTable sorts
// again by the columns' sort values in the app language) and compared with the file, in both languages.

const prefs = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES[prefs.lang], usePrefs: () => ({ t: MESSAGES[prefs.lang], lang: prefs.lang }) };
});

const NOW = Date.parse("2026-11-07T15:00:00Z");

function stock(index: number, symbol: string, name: string, overrides: Partial<ScreenRow> = {}): ScreenRow {
  // Values repeat every few rows, so most columns have ties, and a few are missing.
  const pick = <T,>(values: readonly T[]) => values[index % values.length];
  return {
    symbol,
    name,
    sector: pick(["technology", "financials", "energy", "healthcare"] as const),
    quoteType: "EQUITY",
    price: pick([180.5, 92, 410.25, 92, 33.1]),
    changePercent: pick([1.2, -0.4, 0, 1.2, null]),
    marketCap: pick([3e12, 4e11, 9e10, 4e11]),
    trailingPE: pick([30, 25, null, 12, 25]),
    forwardPE: pick([28, null, 19]),
    priceToBook: pick([40, 2.1, null, 6]),
    dividendYield: pick([0.004, null, 0.031, 0.004]),
    analystRating: pick([1.8, 2.4, null, 2.4, 3.1]),
    nextEarningsDate: pick(["2026-11-12T21:00:00Z", null, "2027-01-29T21:30:00Z", "2026-11-12T21:00:00Z"]),
    earningsDateEstimated: pick([false, true, null]),
    fromHigh52: pick([-0.02, -0.15, -0.02, -0.3]),
    vs50d: pick([0.03, -0.05, 0.11]),
    vs200d: pick([0.1, -0.02, 0.1, null]),
    dollarVolume: pick([9e9, 1.2e9, 4e8]),
    expenseRatio: null,
    netAssets: null,
    ytdReturnPercent: null,
    return1m: pick([0.04, -0.01, 0.04, 0.09]),
    return3m: pick([0.1, 0.02, -0.06]),
    return6m: pick([0.2, -0.1, 0.05, 0.2]),
    rsi14: pick([61, 48, 72, 48]),
    technicalScore: 50,
    factors: { momentum: pick([0.3, -0.1, 0.12]), reversal: 0.01, high52: 0.9, volatility: pick([0.22, 0.35, 0.18, 0.35]), beta: pick([1.2, 0.8, null]) },
    percentiles: {
      momentum: pick([80, 20, 55, 80]),
      reversal: pick([40, 60, 10]),
      high52: pick([90, 30, 70, 90]),
      volatility: pick([25, 75, 50]),
      beta: pick([60, 40, 60, 10]),
    },
    dividendRate: pick([1.04, null, 3.96]),
    exDividendDate: pick([null, "2026-11-10T05:00:00.000Z", null, "2026-12-01T05:00:00.000Z"]),
    ...overrides,
  };
}

/**
 * Names with and without a Chinese name, Latin names Chinese media use, a name that is the ticker in Chinese, and a
 * name in Han characters without a Chinese-name entry: it reads the same in both languages, so only the collation
 * places it (after the Latin names in English, among the Chinese names in Chinese), whatever the runtime's locale.
 */
const STOCKS: ScreenRow[] = [
  ["AAPL", "Apple Inc."],
  ["MSFT", "Microsoft Corporation"],
  ["NVDA", "NVIDIA Corporation"],
  ["XOM", "Exxon Mobil Corporation"],
  ["META", "Meta Platforms, Inc."],
  ["TJX", "The TJX Companies, Inc."],
  ["KRMN", "Karman Holdings Inc."],
  ["IBM", "International Business Machines Corporation"],
  ["JPM", "JPMorgan Chase & Co."],
  ["MS", "Morgan Stanley"],
  ["BRK-B", "Berkshire Hathaway Inc."],
  ["ABBV", "AbbVie Inc."],
  ["PLD", "Prologis, Inc."],
  ["HANZ", "汉字公司"],
].map(([symbol, name], index) => stock(index, symbol, name));

const ETFS: ScreenRow[] = [
  ["SPY", "State Street SPDR S&P 500 ETF Trust"],
  ["QQQ", "Invesco QQQ Trust, Series 1"],
  ["SMH", "VanEck Semiconductor ETF"],
  ["VOX", "Vanguard Communication Services ETF"],
  ["XLK", "State Street Technology Select Sector SPDR ETF"],
].map(([symbol, name], index) =>
  stock(index, symbol, name, { sector: null, quoteType: "ETF", marketCap: null, netAssets: [6e11, 3e11, 2e10, 5e9, 7e10][index], expenseRatio: [0.0009, 0.002, 0.0035, 0.001, 0.0008][index], ytdReturnPercent: [14.2, 18.9, 31.5, 9.1, 18.9][index] }),
);

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
const unescape = (html: string) => html.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);

/** The symbols and names of the table's body rows, top to bottom, as rendered. */
function renderedTable(universe: ScreenerUniverse, set: ColumnSetKey, rows: ScreenRow[], sort: SortState | null, lang: Lang) {
  prefs.lang = lang;
  const t = MESSAGES[lang];
  const columns = screenColumns(columnsFor({ universe, columns: set }), {
    t,
    lang,
    universe,
    set,
    now: NOW,
    watchlist: new Set(),
    onToggleWatch: () => undefined,
    selected: new Set(),
    onToggleSelect: () => undefined,
    allSelected: false,
    someSelected: false,
    onToggleAll: () => undefined,
    visibleCount: rows.length,
  });
  const markup = renderToStaticMarkup(
    createElement(DataTable<ScreenRow>, { rows, columns, rowKey: (row) => row.symbol, caption: "Results", sort, onSortChange: () => undefined }),
  );
  const body = markup.slice(markup.indexOf("<tbody"), markup.indexOf("</tbody>"));
  return body
    .split("<tr")
    .slice(1)
    .map((row) => ({
      symbol: unescape(/<a [^>]*data-row-link[^>]*>([^<]*)<\/a>/.exec(row)?.[1] ?? ""),
      // The name cell is the first text-fg-2 span with the English name as its title (the sector cell comes after it).
      name: unescape(/<span class="text-fg-2" title="[^"]*">([^<]*)<\/span>/.exec(row)?.[1] ?? ""),
    }));
}

/** The symbols and names of the CSV's rows, top to bottom. */
function exported(universe: ScreenerUniverse, rows: ScreenRow[], lang: Lang) {
  const [header, ...records] = parseCsv(toCsv(rows, universe, { lang }), ",").rows;
  expect(header.slice(0, 2)).toEqual(["Symbol", "Name"]);
  return records.map((fields) => ({ symbol: fields[0], name: fields[1] }));
}

describe("the screener CSV", () => {
  for (const universe of ["stocks", "etfs"] as const) {
    const rows = universe === "stocks" ? STOCKS : ETFS;
    for (const lang of ["en", "zh"] as const) {
      it(`lists the ${universe} table's rows in its order and with its names (${lang})`, () => {
        let compared = 0;
        for (const set of COLUMN_SET_KEYS) {
          // Every column of the set (the table sorts it again), and one it lacks (the table keeps the given order).
          const onScreen = columnsFor({ universe, columns: set });
          const offScreen = METRIC_KEYS.find((key) => appliesTo(key, universe) && !onScreen.includes(key));
          const sorts: Array<SortState | null> = [null];
          for (const key of [...onScreen, ...(offScreen ? [offScreen] : [])]) sorts.push({ key, direction: "asc" }, { key, direction: "desc" });
          for (const sort of sorts) {
            const matches = sortScreenRows(rows, sort, lang);
            const context = `${set} ${sort ? `${sort.key}.${sort.direction}` : "unsorted"}`;
            expect(exported(universe, matches, lang), context).toEqual(renderedTable(universe, set, matches, sort, lang));
            compared++;
          }
        }
        expect(compared).toBeGreaterThan(50);
      });
    }
  }

  it("names the rows in Chinese as the table does, and sorts them by those names", () => {
    const zh = exported("stocks", sortScreenRows(STOCKS, { key: "name", direction: "asc" }, "zh"), "zh");
    // Pinyin order of the Han names, then the Latin ones; IBM keeps its English name, Karman has no Chinese one.
    expect(zh.map((row) => row.name)).toEqual([
      "埃克森美孚",
      "艾伯维",
      "安博",
      "伯克希尔·哈撒韦",
      "汉字公司",
      "摩根大通",
      "摩根士丹利",
      "苹果",
      "微软",
      "英伟达",
      "International Business Machines Corporation",
      "Karman Holdings Inc.",
      "Meta",
      "TJX 公司",
    ]);
    const en = exported("stocks", sortScreenRows(STOCKS, { key: "name", direction: "asc" }, "en"), "en");
    // English collation puts the Latin names before the Han one.
    expect(en.map((row) => row.symbol)).toEqual(["ABBV", "AAPL", "BRK-B", "XOM", "IBM", "JPM", "KRMN", "META", "MSFT", "MS", "NVDA", "PLD", "TJX", "HANZ"]);
  });
});
