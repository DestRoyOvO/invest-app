import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  editDistance,
  FUNCTION_GROUPS,
  functionBasePath,
  functionByKey,
  FUNCTIONS,
  functionsByCode,
  GO_SHORTCUTS,
  isFunctionActive,
  NAV_LAYOUT,
  parseCommand,
  shortcutKeys,
  suggestForPath,
  symbolOfToken,
  type CommandMatch,
  type FunctionMatch,
  type ParseContext,
} from "./functions";
import { MESSAGES } from "./i18n/messages";

const ctx: ParseContext = { lastSymbol: "AAPL" };

function first(input: string, context: ParseContext = ctx): CommandMatch | undefined {
  return parseCommand(input, context)[0];
}

function fn(input: string, context: ParseContext = ctx): FunctionMatch {
  const match = first(input, context);
  if (match?.kind !== "function") throw new Error(`"${input}" did not parse to a function: ${JSON.stringify(match)}`);
  return match;
}

describe("the registry", () => {
  it("uses 2 to 4 capital letters per code and one entry per code and scope", () => {
    const seen = new Set<string>();
    for (const entry of FUNCTIONS) {
      expect(entry.code).toMatch(/^[A-Z]{2,4}$/);
      const id = `${entry.code}:${entry.scope}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
    }
    expect(new Set(FUNCTIONS.map((entry) => entry.labelKey)).size).toBe(FUNCTIONS.length);
  });

  it("has the global and security functions of the plan", () => {
    const global = FUNCTIONS.filter((entry) => entry.scope === "global").map((entry) => entry.code);
    const security = FUNCTIONS.filter((entry) => entry.scope === "security").map((entry) => entry.code);
    expect(global.sort()).toEqual(["ALRT", "CORR", "DATA", "EQS", "EVTS", "GC", "HELP", "LAB", "MKT", "MOST", "NOTE", "PORT", "SECT", "WEI", "WL"]);
    expect(security.sort()).toEqual(["ANR", "COMP", "DES", "DVD", "ERN", "FA", "GP", "HDS", "NOTE", "QT", "RISK"]);
    expect(functionsByCode("note").map((entry) => entry.scope).sort()).toEqual(["global", "security"]);
  });

  it("builds the routes each function opens", () => {
    const href = (key: Parameters<typeof functionByKey>[0], symbol?: string, compare?: string[]) => functionByKey(key).href(symbol, { compare });
    expect(href("mkt")).toBe("/");
    expect(href("wl")).toBe("/watchlist");
    expect(href("port")).toBe("/portfolio");
    expect(href("corr")).toBe("/portfolio?tab=correlation");
    expect(href("evts")).toBe("/calendar");
    expect(href("eqs")).toBe("/screener");
    expect(href("most")).toBe("/screener?tab=discover");
    expect(href("sect")).toBe("/sector/technology");
    expect(functionByKey("sect").href(undefined, { lastSector: "energy" })).toBe("/sector/energy");
    expect(functionByKey("sect").href(undefined, { lastSector: "bogus" })).toBe("/sector/technology");
    expect(href("wei")).toBe("/markets");
    expect(href("gc")).toBe("/markets#rates");
    expect(href("lab")).toBe("/lab");
    expect(href("notes")).toBe("/notes");
    expect(href("alrt")).toBe("/alerts");
    expect(href("data")).toBe("/data");
    expect(href("help")).toBe("/help");
    expect(href("des", "NVDA")).toBe("/stock/NVDA");
    expect(href("gp", "NVDA")).toBe("/stock/NVDA#chart");
    expect(href("fa", "NVDA")).toBe("/stock/NVDA?tab=financials");
    expect(href("ern", "NVDA")).toBe("/stock/NVDA?tab=earnings");
    expect(href("anr", "NVDA")).toBe("/stock/NVDA?tab=analysts");
    expect(href("dvd", "NVDA")).toBe("/stock/NVDA?tab=dividends");
    expect(href("hds", "NVDA")).toBe("/stock/NVDA?tab=ownership");
    expect(href("risk", "NVDA")).toBe("/stock/NVDA#risk");
    expect(href("noteSymbol", "NVDA")).toBe("/stock/NVDA#notes");
    expect(href("comp", "AAPL", ["MSFT", "SPY"])).toBe("/stock/AAPL?compare=MSFT,SPY");
    expect(href("comp", "AAPL")).toBe("/stock/AAPL#chart");
    expect(href("gp", "^GSPC")).toBe("/stock/%5EGSPC#chart");
    expect(href("gp")).toBe("/stock/AAPL#chart");
  });

  it("points every function at a page that exists, or that another package builds", () => {
    // Pages built by other wave-2 packages; they exist once the branches are merged.
    const builtElsewhere = new Set(["/portfolio", "/calendar", "/screener", "/markets", "/lab", "/notes", "/alerts", "/data"]);
    const pageFile = (base: string) => {
      const app = join(process.cwd(), "app", "(terminal)");
      if (base === "/") return join(app, "page.tsx");
      if (base === "/stock") return join(app, "stock", "[symbol]", "page.tsx");
      if (base === "/sector") return join(app, "sector", "[key]", "page.tsx");
      return join(app, ...base.slice(1).split("/"), "page.tsx");
    };
    for (const entry of FUNCTIONS) {
      const base = functionBasePath(entry);
      expect(existsSync(pageFile(base)) || builtElsewhere.has(base), `${entry.code} -> ${base}`).toBe(true);
    }
    expect(existsSync(pageFile("/help"))).toBe(true);
  });

  it("has a label and a description in both languages for every function", () => {
    for (const entry of FUNCTIONS) {
      for (const lang of ["en", "zh"] as const) {
        const text = MESSAGES[lang].help.functions[entry.labelKey];
        expect(text.label.length, `${lang} ${entry.labelKey}`).toBeGreaterThan(0);
        expect(text.description.length, `${lang} ${entry.labelKey}`).toBeGreaterThan(0);
        expect(`${text.label} ${text.description}`).not.toMatch(/—/);
      }
    }
  });

  it("never lets an alias name two different codes or another function's code", () => {
    const codesByAlias = new Map<string, Set<string>>();
    for (const entry of FUNCTIONS) {
      for (const alias of entry.aliases) {
        const key = alias.toLowerCase();
        codesByAlias.set(key, (codesByAlias.get(key) ?? new Set()).add(entry.code));
        const other = functionsByCode(alias);
        if (other.length > 0) expect(other.every((o) => o.code === entry.code), `${alias} is the code of another function`).toBe(true);
      }
    }
    for (const [alias, codes] of codesByAlias) expect(codes.size, alias).toBe(1);
  });

  it("gives unique g shortcuts and lists them for the shell", () => {
    const withShortcut = FUNCTIONS.filter((entry) => entry.shortcut);
    for (const entry of withShortcut) expect(entry.shortcut).toMatch(/^g [a-z]$/);
    expect(GO_SHORTCUTS.size).toBe(withShortcut.length);
    expect(GO_SHORTCUTS.get("w")?.code).toBe("WL");
    expect(GO_SHORTCUTS.get("m")?.code).toBe("MKT");
    expect(GO_SHORTCUTS.get("s")?.code).toBe("SECT");
    expect(GO_SHORTCUTS.get("q")?.code).toBe("QT");
    expect(GO_SHORTCUTS.get("p")?.code).toBe("PORT");
    expect(shortcutKeys("g p")).toEqual(["G", "P"]);
    expect(shortcutKeys(undefined)).toEqual([]);
  });

  it("lays out the navigation in the four groups of the plan", () => {
    const codes = Object.fromEntries(FUNCTION_GROUPS.map((group) => [group, NAV_LAYOUT[group].map((key) => functionByKey(key).code)]));
    expect(codes).toEqual({
      markets: ["MKT", "WEI", "SECT", "EQS"],
      portfolio: ["WL", "PORT", "EVTS", "ALRT", "NOTE"],
      research: ["QT", "LAB"],
      tools: ["DATA", "HELP"],
    });
  });

  it("marks the active function by path", () => {
    expect(isFunctionActive(functionByKey("mkt"), "/")).toBe(true);
    expect(isFunctionActive(functionByKey("mkt"), "/watchlist")).toBe(false);
    expect(isFunctionActive(functionByKey("wl"), "/watchlist")).toBe(true);
    expect(isFunctionActive(functionByKey("sect"), "/sector/energy")).toBe(true);
    expect(isFunctionActive(functionByKey("qt"), "/stock/NVDA")).toBe(true);
    expect(isFunctionActive(functionByKey("lab"), "/labs")).toBe(false);
    expect(isFunctionActive(functionByKey("wei"), "/markets")).toBe(true);
  });
});

describe("parseCommand", () => {
  it("reads TICKER CODE and CODE TICKER, in any case", () => {
    for (const input of ["NVDA GP", "nvda gp", "GP NVDA", "gp  nvda"]) {
      const match = fn(input);
      expect(match).toMatchObject({ symbol: "NVDA", usesLastSymbol: false, rank: 0, href: "/stock/NVDA#chart" });
      expect(match.fn.code).toBe("GP");
    }
    expect(fn("AAPL FA").href).toBe("/stock/AAPL?tab=financials");
    expect(fn("ern msft").href).toBe("/stock/MSFT?tab=earnings");
  });

  it("uses the last symbol for a security code alone", () => {
    expect(fn("GP")).toMatchObject({ symbol: "AAPL", usesLastSymbol: true, href: "/stock/AAPL#chart" });
    expect(fn("risk", { lastSymbol: "KO" }).href).toBe("/stock/KO#risk");
    expect(fn("QT", { lastSymbol: "TSLA" }).href).toBe("/stock/TSLA");
  });

  it("compares several symbols with COMP in either order", () => {
    expect(fn("COMP AAPL MSFT SPY")).toMatchObject({ symbol: "AAPL", compare: ["MSFT", "SPY"], href: "/stock/AAPL?compare=MSFT,SPY" });
    expect(fn("AAPL COMP MSFT")).toMatchObject({ symbol: "AAPL", compare: ["MSFT"] });
    expect(fn("aapl, msft comp")).toMatchObject({ symbol: "AAPL", compare: ["MSFT"] });
    expect(fn("COMP AAPL").href).toBe("/stock/AAPL#chart");
  });

  it("opens global functions by code and ignores trailing symbols for them", () => {
    expect(fn("PORT").href).toBe("/portfolio");
    expect(fn("corr").href).toBe("/portfolio?tab=correlation");
    expect(fn("MOST").href).toBe("/screener?tab=discover");
    expect(fn("GC").href).toBe("/markets#rates");
    expect(fn("SECT", { lastSymbol: "AAPL", lastSector: "energy" }).href).toBe("/sector/energy");
    expect(fn("PORT AAPL").href).toBe("/portfolio");
  });

  it("opens all notes for NOTE alone and one symbol's notes with a ticker", () => {
    const alone = parseCommand("NOTE", ctx);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatchObject({ kind: "function", href: "/notes" });
    expect(fn("NVDA NOTE").href).toBe("/stock/NVDA#notes");
    expect(fn("note nvda").href).toBe("/stock/NVDA#notes");
  });

  it("accepts English and Chinese aliases, including EXPORT, IMPORT and BACKUP for DATA", () => {
    for (const input of ["EXPORT", "import", "Backup", "备份"]) expect(fn(input)).toMatchObject({ rank: 1, href: "/data" });
    expect(fn("watchlist").href).toBe("/watchlist");
    expect(fn("自选").href).toBe("/watchlist");
    expect(fn("most active").href).toBe("/screener?tab=discover");
    expect(fn("图表")).toMatchObject({ symbol: "AAPL", href: "/stock/AAPL#chart" });
    expect(fn("chart TSLA")).toMatchObject({ symbol: "TSLA", href: "/stock/TSLA#chart" });
  });

  it("reads exact Chinese company names as symbols", () => {
    expect(symbolOfToken("英伟达")).toBe("NVDA");
    expect(symbolOfToken("苹果")).toBe("AAPL");
    expect(symbolOfToken("不存在的公司")).toBeNull();
    expect(fn("英伟达 GP")).toMatchObject({ symbol: "NVDA", href: "/stock/NVDA#chart" });
    expect(fn("英伟达 图表").href).toBe("/stock/NVDA#chart");
    expect(fn("财报 苹果").href).toBe("/stock/AAPL?tab=earnings");
  });

  it("offers both the function and the ticker when a code is also a known ticker", () => {
    const known = parseCommand("LAB", { ...ctx, isKnownTicker: (symbol) => symbol === "LAB" });
    expect(known.map((m) => m.kind)).toEqual(["function", "symbol"]);
    expect(known[0]).toMatchObject({ href: "/lab" });
    expect(known[1]).toEqual({ kind: "symbol", symbol: "LAB" });
    expect(parseCommand("LAB", ctx).map((m) => m.kind)).toEqual(["function"]);
  });

  it("ranks the ticker-first reading first when both tokens are codes", () => {
    const matches = parseCommand("FA GP", ctx).filter((m): m is FunctionMatch => m.kind === "function");
    expect(matches.map((m) => `${m.fn.code} ${m.symbol}`)).toEqual(["GP FA", "FA GP"]);
  });

  it("offers partial matches after the exact ones", () => {
    expect(parseCommand("E", ctx).map((m) => (m.kind === "function" ? m.fn.code : m.kind))).toEqual(["EQS", "EVTS", "ERN"]);
    expect(fn("PO")).toMatchObject({ rank: 2, href: "/portfolio" });
    expect(fn("calend")).toMatchObject({ rank: 3, href: "/calendar" });
    expect(fn("NVDA F")).toMatchObject({ rank: 2, symbol: "NVDA", href: "/stock/NVDA?tab=financials" });
  });

  it("routes questions to the assistant and returns nothing for empty or unknown input", () => {
    expect(parseCommand("?why is NVDA up", ctx)).toEqual([{ kind: "ask", question: "why is NVDA up" }]);
    expect(parseCommand("？为什么", ctx)).toEqual([{ kind: "ask", question: "为什么" }]);
    expect(parseCommand("?", ctx)).toEqual([]);
    expect(parseCommand("   ", ctx)).toEqual([]);
    expect(parseCommand("zzqx", ctx)).toEqual([]);
    expect(parseCommand("apple inc", ctx)).toEqual([]);
  });

  it("never returns the same destination twice", () => {
    for (const input of ["N", "NO", "NOTE", "C", "chart", "E"]) {
      const hrefs = parseCommand(input, ctx).map((m) => (m.kind === "function" ? m.href : JSON.stringify(m)));
      expect(new Set(hrefs).size, input).toBe(hrefs.length);
    }
  });
});

describe("editDistance", () => {
  it("counts edits and gives up beyond the cap", () => {
    expect(editDistance("portfolio", "portfolio")).toBe(0);
    expect(editDistance("portfollio", "portfolio")).toBe(1);
    expect(editDistance("watchlst", "watchlist")).toBe(1);
    expect(editDistance("abc", "xyz", 2)).toBe(3);
    expect(editDistance("a", "abcdefgh", 3)).toBe(4);
  });
});

describe("suggestForPath", () => {
  it("suggests functions close to the path", () => {
    expect(suggestForPath("/portfollio", ctx).functions[0].fn.code).toBe("PORT");
    expect(suggestForPath("/watchlst", ctx).functions[0].fn.code).toBe("WL");
    expect(suggestForPath("/watch", ctx).functions[0].fn.code).toBe("WL");
    expect(suggestForPath("/help/keys", ctx).functions[0].fn.code).toBe("HELP");
    expect(suggestForPath("/calender", ctx).functions[0].href).toBe("/calendar");
    expect(suggestForPath("/portfollio", ctx).symbol).toBeNull();
  });

  it("offers a ticker-like segment as a quote and falls back to the market, watchlist and help", () => {
    const nvda = suggestForPath("/nvda", ctx);
    expect(nvda.symbol).toBe("NVDA");
    expect(nvda.functions.map((m) => m.fn.code)).toEqual(["MKT", "WL", "HELP"]);
    expect(suggestForPath("/stocks/aapl", ctx).symbol).toBe("AAPL");
    expect(suggestForPath("/stocks/aapl", ctx).functions[0].fn.code).toBe("QT");
    const nothing = suggestForPath("/%E4%BD%A0%E5%A5%BD-there-is-nothing-here", ctx);
    expect(nothing.symbol).toBeNull();
    expect(nothing.functions.map((m) => m.fn.code)).toEqual(["MKT", "WL", "HELP"]);
  });
});
