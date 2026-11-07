import { describe, expect, it } from "vitest";

import {
  combinePositions,
  detectColumns,
  detectHeader,
  fixSymbol,
  mapRows,
  normalizeHeader,
  parseMoney,
  parsePastedPositions,
  positionsCsvRows,
  POSITIONS_TEMPLATE_ROWS,
  readPositionsCsv,
  watchlistCsvRows,
  type ImportRow,
} from "./broker-import";
import { parseCsv, stringifyCsv } from "./csv";

/** The fields that matter in most assertions. */
function brief(row: ImportRow) {
  return { line: row.line, symbol: row.symbol, shares: row.shares, cost: row.cost, skip: row.skip, error: row.error };
}

describe("normalizeHeader", () => {
  it("lowercases, drops punctuation and trailing units", () => {
    expect(normalizeHeader("Avg. Cost ($)")).toBe("avg cost");
    expect(normalizeHeader("Average Price (USD)")).toBe("average price");
    expect(normalizeHeader("成本价(元)")).toBe("成本价");
    expect(normalizeHeader("持仓数量（股）")).toBe("持仓数量");
    expect(normalizeHeader("Quantity (Shares)")).toBe("quantity shares");
    expect(normalizeHeader("Today's Gain/Loss Dollar")).toBe("today s gain loss dollar");
    expect(normalizeHeader("  ")).toBe("");
  });
});

describe("detectColumns", () => {
  it("maps a Fidelity positions export, keeping its account Type column out of the asset type", () => {
    const headers = [
      "Account Number",
      "Account Name",
      "Symbol",
      "Description",
      "Quantity",
      "Last Price",
      "Last Price Change",
      "Current Value",
      "Today's Gain/Loss Dollar",
      "Today's Gain/Loss Percent",
      "Total Gain/Loss Dollar",
      "Total Gain/Loss Percent",
      "Percent Of Account",
      "Cost Basis Total",
      "Average Cost Basis",
      "Type",
    ];
    expect(detectColumns(headers)).toEqual({ symbol: 2, name: 3, quantity: 4, totalCost: 13, avgCost: 14 });
  });

  it("maps a Schwab export: the cost basis is a total and Price is not a cost", () => {
    const headers = ["Symbol", "Description", "Quantity", "Price", "Price Change %", "Market Value", "Cost Basis", "Gain/Loss %", "% Of Account", "Security Type"];
    expect(detectColumns(headers)).toEqual({ symbol: 0, name: 1, quantity: 2, totalCost: 6, assetType: 9 });
  });

  it("maps Chinese broker headers by exact name", () => {
    expect(detectColumns(["证券代码", "证券名称", "持仓数量", "可用数量", "成本价", "市价", "持仓市值", "币种"])).toEqual({ symbol: 0, name: 1, quantity: 2, avgCost: 4, currency: 7 });
    expect(detectColumns(["代码", "名称", "数量", "均价"])).toEqual({ symbol: 0, name: 1, quantity: 2, avgCost: 3 });
    expect(detectColumns(["股票代码", "股数", "成本价(元)"])).toEqual({ symbol: 0, quantity: 1, avgCost: 2 });
  });

  it("prefers a cost per share over a total, and partial matches inside longer headers", () => {
    expect(detectColumns(["Ticker", "Position", "Avg Price", "Cost Basis"])).toEqual({ symbol: 0, quantity: 1, avgCost: 2, totalCost: 3 });
    expect(detectColumns(["Symbol/CUSIP", "Quantity (Shares)", "Total Cost (USD)"])).toEqual({ symbol: 0, quantity: 1, totalCost: 2 });
    expect(detectColumns(["symbol", "shares", "cost"])).toEqual({ symbol: 0, quantity: 1, avgCost: 2 });
    expect(detectColumns(["Symbol", "Shares", "Price Paid $"])).toEqual({ symbol: 0, quantity: 1, avgCost: 2 });
  });

  it("finds nothing in data rows", () => {
    expect(detectColumns(["AAPL", "25", "201.30"])).toEqual({});
  });
});

describe("detectHeader", () => {
  it("skips title lines before the header", () => {
    const rows = [["Positions for account Individual ...123 as of 09:30 PM ET"], ["Symbol", "Description", "Quantity", "Cost Basis"], ["AAPL", "APPLE INC", "25", "$5,032.50"]];
    expect(detectHeader(rows)).toEqual({ headerRow: 1, headers: rows[1], mapping: { symbol: 0, name: 1, quantity: 2, totalCost: 3 } });
  });

  it("needs both a symbol and a quantity column", () => {
    expect(detectHeader([["Symbol", "Name"], ["AAPL", "Apple"]])).toBeNull();
    expect(detectHeader([])).toBeNull();
  });
});

describe("parseMoney", () => {
  it("reads broker money formats", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("(12.30)")).toBe(-12.3);
    expect(parseMoney("($12.30)")).toBe(-12.3);
    expect(parseMoney("-$12.30")).toBe(-12.3);
    expect(parseMoney("12.30-")).toBe(-12.3);
    expect(parseMoney("−12.30")).toBe(-12.3);
    expect(parseMoney("+0.5")).toBe(0.5);
    expect(parseMoney("1,234.50*")).toBe(1234.5);
    expect(parseMoney("HK$ 320.00")).toBe(320);
    expect(parseMoney("1 234,56 €")).toBe(1234.56);
    expect(parseMoney("1.234.567,89")).toBe(1234567.89);
    expect(parseMoney("1'234.50")).toBe(1234.5);
    expect(parseMoney("¥1,250")).toBe(1250);
    expect(parseMoney("100股")).toBe(100);
    expect(parseMoney("25 shares")).toBe(25);
    expect(parseMoney(".5")).toBe(0.5);
    expect(parseMoney("１２３")).toBe(123);
  });

  it("tells thousands separators from decimal commas", () => {
    expect(parseMoney("1,234")).toBe(1234);
    expect(parseMoney("1,234", { decimalComma: true })).toBe(1.234);
    expect(parseMoney("201,30")).toBe(201.3);
    expect(parseMoney("1,234,567")).toBe(1234567);
    expect(parseMoney("1.234", { decimalComma: true })).toBe(1234);
    expect(parseMoney("1.234")).toBe(1.234);
  });

  it("returns null for text that is not a number", () => {
    for (const text of ["", "  ", "--", "N/A", "n/a", "abc", "1,2,3", "12.3.4", "1e5", "$", null, undefined]) expect(parseMoney(text)).toBeNull();
  });
});

describe("fixSymbol", () => {
  it("rewrites US share classes to Yahoo's dash, leaving exchange suffixes alone", () => {
    for (const raw of ["BRK.B", "BRK/B", "BRK B", "brk.b"]) expect(fixSymbol(raw)).toEqual({ symbol: "BRK-B", fix: "shareClass" });
    expect(fixSymbol("BF.A")).toEqual({ symbol: "BF-A", fix: "shareClass" });
    expect(fixSymbol("VOD.L")).toEqual({ symbol: "VOD.L", fix: null });
    expect(fixSymbol("SHOP.TO")).toEqual({ symbol: "SHOP.TO", fix: null });
    expect(fixSymbol("BRK-B")).toEqual({ symbol: "BRK-B", fix: null });
  });

  it("writes Hong Kong codes with four digits", () => {
    expect(fixSymbol("00700")).toEqual({ symbol: "0700.HK", fix: "hongKong" });
    expect(fixSymbol("09988")).toEqual({ symbol: "9988.HK", fix: "hongKong" });
    expect(fixSymbol("00005")).toEqual({ symbol: "0005.HK", fix: "hongKong" });
    expect(fixSymbol("700.HK")).toEqual({ symbol: "0700.HK", fix: "hongKong" });
    expect(fixSymbol("00700.hk")).toEqual({ symbol: "0700.HK", fix: "hongKong" });
    expect(fixSymbol("0700.HK")).toEqual({ symbol: "0700.HK", fix: null });
    expect(fixSymbol("HK.00700")).toEqual({ symbol: "0700.HK", fix: "prefix" });
  });

  it("gives six-digit mainland codes an exchange by their leading digits", () => {
    expect(fixSymbol("600519")).toEqual({ symbol: "600519.SS", fix: "shanghai" });
    expect(fixSymbol("688981")).toEqual({ symbol: "688981.SS", fix: "shanghai" });
    expect(fixSymbol("510300")).toEqual({ symbol: "510300.SS", fix: "shanghai" });
    expect(fixSymbol("000001")).toEqual({ symbol: "000001.SZ", fix: "shenzhen" });
    expect(fixSymbol("300750")).toEqual({ symbol: "300750.SZ", fix: "shenzhen" });
    expect(fixSymbol("159915")).toEqual({ symbol: "159915.SZ", fix: "shenzhen" });
    expect(fixSymbol("600519.SH")).toEqual({ symbol: "600519.SS", fix: "shanghai" });
    expect(fixSymbol("000001.SZ")).toEqual({ symbol: "000001.SZ", fix: null });
    expect(fixSymbol("SH.600519")).toEqual({ symbol: "600519.SS", fix: "prefix" });
    expect(fixSymbol("SZ.000001")).toEqual({ symbol: "000001.SZ", fix: "prefix" });
    // Beijing codes have no Yahoo suffix rule here; the live check decides.
    expect(fixSymbol("430047")).toEqual({ symbol: "430047", fix: null });
  });

  it("drops market prefixes, footnote marks and a leading $, and resolves exact Chinese names", () => {
    expect(fixSymbol("US.AAPL")).toEqual({ symbol: "AAPL", fix: "prefix" });
    expect(fixSymbol("AAPL*")).toEqual({ symbol: "AAPL", fix: null });
    expect(fixSymbol("$nvda")).toEqual({ symbol: "NVDA", fix: null });
    expect(fixSymbol("苹果")).toEqual({ symbol: "AAPL", fix: "chineseName" });
    expect(fixSymbol("不存在的公司")).toEqual({ symbol: null, fix: null });
    expect(fixSymbol("not a symbol!")).toEqual({ symbol: null, fix: null });
    expect(fixSymbol("  ")).toEqual({ symbol: null, fix: null });
  });
});

describe("mapRows", () => {
  it("imports a Fidelity export, skipping money market, pending cash and options with reasons", () => {
    const text = [
      "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Average Cost Basis,Type",
      "Z123,Individual,SPAXX**,HELD IN MONEY MARKET,,,$1520.10,,,Cash",
      "Z123,Individual,AAPL,APPLE INC,25,$268.47,$6711.75,$5032.50,$201.30,Cash",
      "Z123,Individual,BRK.B,BERKSHIRE HATHAWAY INC CLASS B,4,$490.00,$1960.00,$1600.00,$400.00,Margin",
      "Z123,Individual, -AAPL250117C150,AAPL JAN 17 2025 $150 CALL,-1,$5.00,-$500.00,,,Margin",
      "Z123,Individual,Pending Activity,,,,$-20.00,,,",
      "",
      '"The data and information in this spreadsheet is provided to you solely for your use."',
      '"Date downloaded Nov-07-2026 4:30 p.m ET"',
    ].join("\n");
    const { table, detection } = readPositionsCsv(text);
    expect(detection?.headerRow).toBe(0);
    const rows = mapRows(table, detection!.headerRow, detection!.mapping);
    expect(rows.map(brief)).toEqual([
      { line: 2, symbol: null, shares: null, cost: null, skip: "moneyMarket", error: null },
      { line: 3, symbol: "AAPL", shares: 25, cost: 201.3, skip: null, error: null },
      { line: 4, symbol: "BRK-B", shares: 4, cost: 400, skip: null, error: null },
      { line: 5, symbol: null, shares: null, cost: null, skip: "option", error: null },
      { line: 6, symbol: null, shares: null, cost: null, skip: "cash", error: null },
    ]);
    expect(rows[2].fix).toBe("shareClass");
    expect(rows[2].rawSymbol).toBe("BRK.B");
    expect(rows[1].name).toBe("APPLE INC");
  });

  it("imports a Schwab export: a total cost basis is divided by the quantity", () => {
    const text = [
      '"Positions for account Individual ...123 as of 09:30 PM ET, 2026/11/06"',
      "",
      '"Symbol","Description","Quantity","Price","Market Value","Cost Basis","Security Type"',
      '"MSFT","MICROSOFT CORP","10","$497.10","$4,971.00","$4,150.00","Equity"',
      '"VOO","VANGUARD S&P 500 ETF","3.5","$620.00","$2,170.00","$1,750.00","ETFs & Closed End Funds"',
      '"AAPL 01/17/2027 300.00 C","CALL APPLE INC $300 EXP 01/17/27","1","$12.00","$1,200.00","$900.00","Option"',
      '"Cash & Cash Investments","--","--","--","$3,200.00","--","Cash and Money Market"',
      '"Account Total","--","--","--","$11,541.00","$6,800.00","--"',
    ].join("\r\n");
    const { table, detection } = readPositionsCsv(text);
    expect(detection?.headerRow).toBe(1);
    expect(mapRows(table, detection!.headerRow, detection!.mapping).map(brief)).toEqual([
      { line: 4, symbol: "MSFT", shares: 10, cost: 415, skip: null, error: null },
      { line: 5, symbol: "VOO", shares: 3.5, cost: 500, skip: null, error: null },
      { line: 6, symbol: null, shares: null, cost: null, skip: "option", error: null },
      { line: 7, symbol: null, shares: null, cost: null, skip: "cash", error: null },
      { line: 8, symbol: null, shares: null, cost: null, skip: "total", error: null },
    ]);
  });

  it("imports a semicolon file with decimal commas and Chinese headers", () => {
    const text = "证券代码;证券名称;持仓数量;成本价\n00700;腾讯控股;100;320,50\n600519;贵州茅台;10;1.450,00\n合计;;;\n";
    const table = parseCsv(text);
    expect(table.delimiter).toBe(";");
    const detection = detectHeader(table.rows)!;
    expect(mapRows(table, detection.headerRow, detection.mapping, { decimalComma: true }).map(brief)).toEqual([
      { line: 2, symbol: "0700.HK", shares: 100, cost: 320.5, skip: null, error: null },
      { line: 3, symbol: "600519.SS", shares: 10, cost: 1450, skip: null, error: null },
      { line: 4, symbol: null, shares: null, cost: null, skip: "total", error: null },
    ]);
  });

  it("reports missing values per row and skips short positions", () => {
    const table = parseCsv("Symbol,Quantity,Average cost\nAAPL,,200\nMSFT,10,\n???,5,10\nTSLA,-3,250\nNVDA,0,100\n");
    const detection = detectHeader(table.rows)!;
    expect(mapRows(table, detection.headerRow, detection.mapping).map((row) => [row.line, row.skip ?? row.error])).toEqual([
      [2, "quantity"],
      [3, "cost"],
      [4, "symbol"],
      [5, "short"],
      [6, "quantity"],
    ]);
  });
});

describe("parsePastedPositions", () => {
  it("reads one position per line with commas, semicolons, tabs or spaces", () => {
    const rows = parsePastedPositions("AAPL, 25, 201.30\nmsft,10,415\n0700.HK 100 320\nBRK-A, 1, 650,000.00\n\n# a comment\nNVDA;5;180,25\n");
    expect(rows.map(brief)).toEqual([
      { line: 1, symbol: "AAPL", shares: 25, cost: 201.3, skip: null, error: null },
      { line: 2, symbol: "MSFT", shares: 10, cost: 415, skip: null, error: null },
      { line: 3, symbol: "0700.HK", shares: 100, cost: 320, skip: null, error: null },
      { line: 4, symbol: "BRK-A", shares: 1, cost: 650000, skip: null, error: null },
      { line: 7, symbol: "NVDA", shares: 5, cost: 180.25, skip: null, error: null },
    ]);
  });

  it("accepts full-width punctuation, Chinese names and a header line", () => {
    const rows = parsePastedPositions("Symbol, Shares, Cost\n苹果，10，180\n00700　100　320");
    expect(rows.map(brief)).toEqual([
      { line: 2, symbol: "AAPL", shares: 10, cost: 180, skip: null, error: null },
      { line: 3, symbol: "0700.HK", shares: 100, cost: 320, skip: null, error: null },
    ]);
    expect(rows[0].fix).toBe("chineseName");
  });

  it("routes a pasted table with headers through the column mapper", () => {
    const rows = parsePastedPositions("Symbol\tDescription\tQuantity\tAverage Cost Basis\nAAPL\tAPPLE INC\t25\t$201.30\nSPAXX**\tMONEY MARKET\t\t\n");
    expect(rows.map(brief)).toEqual([
      { line: 2, symbol: "AAPL", shares: 25, cost: 201.3, skip: null, error: null },
      { line: 3, symbol: null, shares: null, cost: null, skip: "moneyMarket", error: null },
    ]);
  });

  it("flags lines it cannot use", () => {
    const rows = parsePastedPositions("AAPL\nMSFT 10\nTSLA x 200\n!!! 1 2\nAMD -5 100");
    expect(rows.map((row) => [row.line, row.skip ?? row.error])).toEqual([
      [1, "format"],
      [2, "cost"],
      [3, "quantity"],
      [4, "symbol"],
      [5, "short"],
    ]);
    expect(rows[0].symbol).toBe("AAPL");
  });

  it("returns nothing for blank text", () => {
    expect(parsePastedPositions("  \n ")).toEqual([]);
  });
});

describe("combinePositions", () => {
  it("adds up repeated symbols with a share-weighted cost", () => {
    const { holdings, combined } = combinePositions([
      { symbol: "AAPL", shares: 10, cost: 100 },
      { symbol: "MSFT", shares: 5, cost: 400 },
      { symbol: "AAPL", shares: 30, cost: 200 },
      { symbol: "BAD", shares: 0, cost: 10 },
    ]);
    expect(holdings).toEqual({ AAPL: { shares: 40, cost: 175 }, MSFT: { shares: 5, cost: 400 } });
    expect(combined).toEqual(["AAPL"]);
  });

  it("keeps fractional shares exact enough", () => {
    expect(combinePositions([{ symbol: "VOO", shares: 0.1, cost: 500 }, { symbol: "VOO", shares: 0.2, cost: 500 }]).holdings.VOO).toEqual({ shares: 0.3, cost: 500 });
  });
});

describe("CSV exports", () => {
  const holdings = { AAPL: { shares: 25, cost: 201.3 }, MSFT: { shares: 10, cost: 415 }, "0700.HK": { shares: 100, cost: 320 }, XYZ: { shares: 1, cost: 5 } };
  const quotes = new Map([
    ["AAPL", { price: 268.47, change: 1.2, currency: "USD" }],
    ["MSFT", { price: 497.1, change: -2, currency: "USD" }],
    ["0700.HK", { price: 640.5, change: 3, currency: "HKD" }],
  ]);

  it("writes positions with values and weights in the base currency", () => {
    const rows = positionsCsvRows(holdings, quotes);
    expect(rows[0]).toEqual(["Symbol", "Shares", "Average cost", "Currency", "Last", "Value", "Weight %", "Unrealized P&L", "Unrealized P&L %"]);
    expect(rows[1]).toEqual(["AAPL", 25, 201.3, "USD", 268.47, 6711.75, 57.45, 1679.25, 33.37]);
    expect(rows[2]).toEqual(["MSFT", 10, 415, "USD", 497.1, 4971, 42.55, 821, 19.78]);
    expect(rows[3]).toEqual(["0700.HK", 100, 320, "HKD", 640.5, 64050, null, 32050, 100.16]);
    expect(rows[4]).toEqual(["XYZ", 1, 5, null, null, null, null, null, null]);
  });

  it("writes shares and cost only without quotes", () => {
    expect(positionsCsvRows({ AAPL: { shares: 25, cost: 201.3 } }, null)).toEqual([
      ["Symbol", "Shares", "Average cost", "Currency", "Last", "Value", "Weight %", "Unrealized P&L", "Unrealized P&L %"],
      ["AAPL", 25, 201.3, null, null, null, null, null, null],
    ]);
  });

  it("re-imports its own positions file", () => {
    const text = stringifyCsv(positionsCsvRows(holdings, quotes));
    const { table, detection } = readPositionsCsv(text);
    const rows = mapRows(table, detection!.headerRow, detection!.mapping);
    const inputs = rows.map((row) => ({ symbol: row.symbol!, shares: row.shares!, cost: row.cost! }));
    expect(combinePositions(inputs).holdings).toEqual(holdings);
  });

  it("re-imports the template", () => {
    const { table, detection } = readPositionsCsv(stringifyCsv(POSITIONS_TEMPLATE_ROWS));
    expect(mapRows(table, detection!.headerRow, detection!.mapping).map(brief)).toEqual([
      { line: 2, symbol: "AAPL", shares: 25, cost: 201.3, skip: null, error: null },
      { line: 3, symbol: "MSFT", shares: 10, cost: 415, skip: null, error: null },
      { line: 4, symbol: "0700.HK", shares: 100, cost: 320, skip: null, error: null },
    ]);
  });

  it("writes the watchlist in order, with or without quotes", () => {
    const watchQuotes = new Map([["AAPL", { name: "Apple Inc.", currency: "USD", price: 268.47, changePercent: 0.4512 }]]);
    expect(watchlistCsvRows(["AAPL", "SPY"], watchQuotes)).toEqual([
      ["Symbol", "Name", "Currency", "Last", "Change %"],
      ["AAPL", "Apple Inc.", "USD", 268.47, 0.45],
      ["SPY", null, null, null, null],
    ]);
    expect(watchlistCsvRows(["AAPL"], null)[1]).toEqual(["AAPL", null, null, null, null]);
  });
});
