import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { PORT_TABS } from "@/components/portfolio/port-view";
import { QUOTE_TABS } from "@/components/stock/quote-utils";

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
  safeDecode,
  shortcutKeys,
  suggestForPath,
  symbolOfToken,
  type CommandMatch,
  type FunctionDef,
  type FunctionMatch,
  type ParseContext,
} from "./functions";
import { MESSAGES } from "./i18n/messages";
import { viewFromParams } from "./screens";
import { getSector, SECTOR_KEYS } from "./universe";

const ctx: ParseContext = { lastSymbol: "AAPL" };

// ---------------------------------------------------------------------------
// The merged app as it is on disk: page routes under app/ and element ids in the components
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const APP = join(ROOT, "app");

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every page route under app/ as a pattern over the pathname: route groups such as (terminal) and parallel slots are
 * left out, [param] matches one segment and [...param] several. Private folders (_x) and API routes have no pages.
 */
function pageRoutes(): Array<{ file: string; pattern: RegExp }> {
  return filesUnder(APP, (name) => /^page\.(tsx|ts|jsx|js|mdx)$/.test(name))
    .map((file) => relative(APP, file).split(sep).slice(0, -1))
    .filter((segments) => !segments.some((segment) => segment.startsWith("_") || segment === "api"))
    .map((segments) => {
      const parts = segments
        .filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith("@"))
        .map((segment) => {
          if (segment.startsWith("[[...")) return "(?:/.+)?";
          if (segment.startsWith("[...")) return "/.+";
          if (segment.startsWith("[")) return "/[^/]+";
          return `/${escapeRegExp(segment)}`;
        });
      return { file: segments.join("/") || "(root)", pattern: new RegExp(`^${parts.join("") || "/"}$`) };
    });
}

const COMPONENTS = join(ROOT, "components");

/**
 * The components of a page: the folder named after its first path segment (/stock/NVDA in components/stock, / in
 * components/market) and the components those files import from other folders (the quote page imports NotesPanel).
 */
function pageComponentFiles(pathname: string): string[] {
  const folder = pathname.split("/")[1] || "market";
  const dir = readdirSync(COMPONENTS).includes(folder) ? join(COMPONENTS, folder) : COMPONENTS;
  const own = filesUnder(dir, (name) => name.endsWith(".tsx"));
  const imported = own.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/from "@\/components\/([^"]+)"/g)].map((match) => join(COMPONENTS, `${match[1]}.tsx`)));
  return [...new Set([...own, ...imported.filter((file) => existsSync(file))])];
}

/** How many elements with the id a #anchor scrolls to the components of a page declare: exactly one is right. */
function elementIdCount(pathname: string, id: string): number {
  return pageComponentFiles(pathname).reduce((count, file) => count + readFileSync(file, "utf8").split(`id="${id}"`).length - 1, 0);
}

/** Every href a function can produce: with typed and fallback symbols, comparisons, every sector and every anchor alias. */
function hrefsOf(entry: FunctionDef): string[] {
  const hrefs = new Set<string>();
  if (entry.scope === "security") {
    for (const symbol of [undefined, "NVDA", "^GSPC", "BRK-B", "0700.HK"]) {
      hrefs.add(entry.href(symbol));
      hrefs.add(entry.href(symbol, { compare: ["MSFT", "SPY"] }));
    }
  } else {
    for (const lastSector of [null, "bogus", ...SECTOR_KEYS]) hrefs.add(entry.href(undefined, { lastSector }));
  }
  for (const alias of Object.keys(entry.anchors ?? {})) {
    const match = parseCommand(alias, ctx).find((m): m is FunctionMatch => m.kind === "function" && m.fn === entry);
    if (match) hrefs.add(match.href);
  }
  return [...hrefs];
}

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

  it("finds the pages of the merged app under app/", () => {
    const routes = pageRoutes();
    const matching = (path: string) => routes.filter((route) => route.pattern.test(path)).map((route) => route.file);
    expect(matching("/")).toEqual(["(terminal)"]);
    expect(matching("/stock/NVDA")).toEqual(["(terminal)/stock/[symbol]"]);
    expect(matching("/sector/energy")).toEqual(["(terminal)/sector/[key]"]);
    expect(matching("/unlock")).toEqual(["unlock"]);
    expect(matching("/stock")).toEqual([]);
    expect(matching("/api/health")).toEqual([]);
  });

  it("points every function at a page under app/", () => {
    const routes = pageRoutes();
    for (const entry of FUNCTIONS) {
      for (const href of hrefsOf(entry)) {
        const path = href.split(/[?#]/)[0];
        expect(
          routes.some((route) => route.pattern.test(path)),
          `${entry.code} -> ${href}`,
        ).toBe(true);
        // functionBasePath (the active navigation item) is the start of every route of the function.
        expect(path === functionBasePath(entry) || path.startsWith(`${functionBasePath(entry)}/`), `${entry.code} -> ${href}`).toBe(true);
      }
    }
  });

  it("opens only tabs, sectors and anchors that exist on those pages", () => {
    for (const entry of FUNCTIONS) {
      for (const href of hrefsOf(entry)) {
        const url = new URL(href, "http://localhost");
        const where = `${entry.code} -> ${href}`;
        const tab = url.searchParams.get("tab");
        if (url.pathname.startsWith("/stock/")) {
          if (tab !== null) expect(QUOTE_TABS as readonly string[], where).toContain(tab);
          for (const symbol of url.searchParams.get("compare")?.split(",") ?? []) expect(symbol, where).toMatch(/^[A-Z0-9^.=-]+$/);
        } else if (url.pathname === "/portfolio") {
          if (tab !== null) expect(PORT_TABS as readonly string[], where).toContain(tab);
        } else if (url.pathname === "/screener") {
          if (tab !== null) expect(viewFromParams(url.searchParams).tab, where).toBe(tab);
        } else {
          expect(tab, where).toBeNull();
        }
        if (url.pathname.startsWith("/sector/")) expect(getSector(url.pathname.slice("/sector/".length)), where).toBeTruthy();
        if (url.hash) expect(elementIdCount(url.pathname, url.hash.slice(1)), `${where}: elements with id "${url.hash.slice(1)}"`).toBe(1);
      }
    }
  });

  it("lets anchor aliases open a part of the page and nothing else", () => {
    for (const entry of FUNCTIONS) {
      const aliases = new Set(entry.aliases.map((alias) => alias.trim().toLowerCase()));
      for (const [alias, anchor] of Object.entries(entry.anchors ?? {})) {
        expect(aliases.has(alias), `${entry.code}: ${alias} is not one of its aliases`).toBe(true);
        expect(fn(alias).href).toBe(`${entry.href().split("#")[0]}${anchor}`);
      }
    }
    expect(fn("IMPORT").href).toBe("/data#import");
    expect(fn("导入").href).toBe("/data#import");
    expect(fn("Backup").href).toBe("/data#restore");
    expect(fn("export").href).toBe("/data#restore");
    expect(fn("粘贴").href).toBe("/data#paste");
    expect(fn("DATA").href).toBe("/data");
    expect(fn("数据").href).toBe("/data");
    // A partial alias opens the page itself.
    expect(fn("impo")).toMatchObject({ rank: 3, href: "/data" });
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
    for (const input of ["EXPORT", "import", "Backup", "备份", "导出", "恢复", "paste"]) expect(fn(input)).toMatchObject({ rank: 1, fn: functionByKey("data") });
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

describe("safeDecode", () => {
  it("decodes percent-encoding and leaves malformed input as it is", () => {
    expect(safeDecode("consumer%20staples")).toBe("consumer staples");
    expect(safeDecode("%E4%BD%A0")).toBe("你");
    expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A");
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
