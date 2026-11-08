import { describe, expect, it } from "vitest";

import { ariaSort, compareSortValues, nextSort, sortRows } from "./table-sort";

describe("compareSortValues", () => {
  it("compares numbers in both directions", () => {
    expect(compareSortValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareSortValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareSortValues(2, 2, "asc")).toBe(0);
    expect(compareSortValues(-0.5, 0.5, "asc")).toBeLessThan(0);
  });

  it("puts missing values last in both directions", () => {
    for (const direction of ["asc", "desc"] as const) {
      expect(compareSortValues(null, 1, direction)).toBeGreaterThan(0);
      expect(compareSortValues(1, undefined, direction)).toBeLessThan(0);
      expect(compareSortValues(Number.NaN, -100, direction)).toBeGreaterThan(0);
      expect(compareSortValues(null, undefined, direction)).toBe(0);
    }
  });

  it("sorts strings in natural, case-insensitive order", () => {
    expect(compareSortValues("A2", "A10", "asc")).toBeLessThan(0);
    expect(compareSortValues("apple", "Banana", "asc")).toBeLessThan(0);
    expect(compareSortValues("nvda", "NVDA", "asc")).toBe(0);
  });

  it("sorts strings in the locale it is given: Chinese by pinyin under zh-CN", () => {
    const names = ["英伟达", "Booking", "苹果", "安进", "宝洁", "微软"];
    const inLocale = (locale: string) => [...names].sort((a, b) => compareSortValues(a, b, "asc", locale));
    expect(inLocale("zh-CN")).toEqual(["安进", "宝洁", "苹果", "微软", "英伟达", "Booking"]);
    expect(inLocale("en")).toEqual(["Booking", "安进", "宝洁", "微软", "英伟达", "苹果"]);
    expect(compareSortValues("A2", "A10", "asc", "zh-CN")).toBeLessThan(0);
  });

  it("orders booleans false before true, and mixed types deterministically", () => {
    expect(compareSortValues(false, true, "asc")).toBeLessThan(0);
    expect(compareSortValues(3, "x", "asc")).toBeLessThan(0);
    expect(compareSortValues("x", 3, "asc")).toBeGreaterThan(0);
  });
});

describe("sortRows", () => {
  const rows = [
    { symbol: "AAPL", change: 1.2, pe: 30 },
    { symbol: "MSFT", change: -0.4, pe: null },
    { symbol: "NVDA", change: 1.2, pe: 45 },
    { symbol: "AMZN", change: 3.1, pe: 38 },
    { symbol: "KO", change: -0.4, pe: 22 },
  ];

  it("sorts descending and keeps equal rows in their original order", () => {
    expect(sortRows(rows, (r) => r.change, "desc").map((r) => r.symbol)).toEqual(["AMZN", "AAPL", "NVDA", "MSFT", "KO"]);
    expect(sortRows(rows, (r) => r.change, "asc").map((r) => r.symbol)).toEqual(["MSFT", "KO", "AAPL", "NVDA", "AMZN"]);
  });

  it("uses the tie-breaker before the original order", () => {
    const bySymbolDesc = (a: { symbol: string }, b: { symbol: string }) => b.symbol.localeCompare(a.symbol);
    expect(sortRows(rows, (r) => r.change, "desc", bySymbolDesc).map((r) => r.symbol)).toEqual(["AMZN", "NVDA", "AAPL", "MSFT", "KO"]);
  });

  it("keeps a missing value last in both directions", () => {
    expect(sortRows(rows, (r) => r.pe, "asc").map((r) => r.symbol)).toEqual(["KO", "AAPL", "AMZN", "NVDA", "MSFT"]);
    expect(sortRows(rows, (r) => r.pe, "desc").map((r) => r.symbol)).toEqual(["NVDA", "AMZN", "AAPL", "KO", "MSFT"]);
  });

  it("passes the locale on to the string comparison", () => {
    const named = [{ name: "英伟达" }, { name: "苹果" }, { name: "安进" }];
    expect(sortRows(named, (r) => r.name, "asc", undefined, "zh-CN").map((r) => r.name)).toEqual(["安进", "苹果", "英伟达"]);
    expect(sortRows(named, (r) => r.name, "desc", undefined, "zh-CN").map((r) => r.name)).toEqual(["英伟达", "苹果", "安进"]);
  });

  it("returns a copy and leaves the input untouched", () => {
    const before = rows.map((r) => r.symbol);
    const sorted = sortRows(rows, (r) => r.symbol, "asc");
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });

  it("is stable when re-sorting already sorted data", () => {
    const once = sortRows(rows, (r) => r.change, "desc");
    const twice = sortRows(once, (r) => r.change, "desc");
    expect(twice.map((r) => r.symbol)).toEqual(once.map((r) => r.symbol));
  });
});

describe("nextSort", () => {
  it("cycles first direction, opposite direction, unsorted", () => {
    const first = nextSort(null, "change", "desc");
    expect(first).toEqual({ key: "change", direction: "desc" });
    const second = nextSort(first, "change", "desc");
    expect(second).toEqual({ key: "change", direction: "asc" });
    expect(nextSort(second, "change", "desc")).toBeNull();
  });

  it("starts over with the first direction on another column", () => {
    expect(nextSort({ key: "change", direction: "asc" }, "symbol", "asc")).toEqual({ key: "symbol", direction: "asc" });
  });
});

describe("ariaSort", () => {
  it("names the sorted column only", () => {
    expect(ariaSort({ key: "pe", direction: "asc" }, "pe")).toBe("ascending");
    expect(ariaSort({ key: "pe", direction: "desc" }, "pe")).toBe("descending");
    expect(ariaSort({ key: "pe", direction: "desc" }, "change")).toBeUndefined();
    expect(ariaSort(null, "pe")).toBeUndefined();
  });
});
