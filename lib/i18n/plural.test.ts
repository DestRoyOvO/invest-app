import { describe, expect, it } from "vitest";

import { tpl } from "@/lib/format";

import { MESSAGES } from "./messages";
import { plural, pluralForm, type CountMessage, type PluralForms } from "./plural";

const pair: PluralForms = { one: "{n} position", other: "{n} positions" };

describe("plural", () => {
  it("takes the English one form for exactly one and the other form for every other count", () => {
    expect(plural(pair, 1)).toBe("1 position");
    expect(plural(pair, 0)).toBe("0 positions");
    expect(plural(pair, 2)).toBe("2 positions");
    expect(plural(pair, 21)).toBe("21 positions");
    // Fractional shares are plural in English: 1.5 shares, and 0.5 shares.
    expect(pluralForm({ one: "{n} share", other: "{n} shares" }, 1.5)).toBe("{n} shares");
    expect(pluralForm({ one: "{n} share", other: "{n} shares" }, 0.5)).toBe("{n} shares");
  });

  it("keeps the one string of a language without plural forms", () => {
    expect(plural("{n} 个持仓", 1)).toBe("1 个持仓");
    expect(plural("{n} 个持仓", 3)).toBe("3 个持仓");
  });

  it("fills the other placeholders, and {n} from the values when the count is shown in another form", () => {
    expect(plural({ one: "{n} of {m} position", other: "{n} of {m} positions" }, 1, { n: 1, m: 1 })).toBe("1 of 1 position");
    expect(plural({ one: "{n} of {m} position", other: "{n} of {m} positions" }, 4, { n: 3, m: 4 })).toBe("3 of 4 positions");
    expect(plural({ one: "You hold {n} share.", other: "You hold {n} shares." }, 1000, { n: "1,000" })).toBe("You hold 1,000 shares.");
    expect(plural({ one: "{rows} row", other: "{rows} rows" }, 1, { rows: 1 })).toBe("1 row");
  });
});

/** Every English message that counts with a plural form, by its path in the dictionary, and the placeholder it counts by. */
const CONVERTED: Readonly<Record<string, string>> = {
  "watchlist.count": "n",
  "watchlist.posLabel": "shares",
  "watchlist.positionsCount": "n",
  "stock.stats.analysts": "n",
  "portfolio.tooMany": "n",
  "port.kpi.effectiveSub": "n",
  "port.risk.weightNote": "n",
  "port.coverage.count": "m",
  "earnings.analystCount": "n",
  "earnings.note.consensus": "n",
  "earnings.note.beats": "n",
  "earnings.analysts.analysts": "n",
  "calendar.cashLabel": "shares",
  "calendar.surprises.label": "n",
  "research.dividends.payments": "n",
  "research.dividends.holderNote": "shares",
  "research.dividends.holderNoteTrailing": "shares",
  "research.ownership.transactions": "n",
  "markets.breadth.distributionLabel": "n",
  "data.csv.fileMeta": "rows",
  "data.review.importCount": "n",
  "ai.chat.messageCount": "n",
};

type Tree = { [key: string]: Tree | string };

function at(tree: object, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Tree)[key] : undefined), tree);
}

function isPair(value: unknown): value is PluralForms {
  return typeof value === "object" && value !== null && Object.keys(value).sort().join() === "one,other";
}

/** The paths of every { one, other } pair in a dictionary. */
function pairs(tree: object, path: string[] = []): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    if (isPair(value)) return [[...path, key].join(".")];
    return value && typeof value === "object" ? pairs(value, [...path, key]) : [];
  });
}

const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe("count messages", () => {
  it("are exactly the converted ones, each a pair in English and one string in Chinese", () => {
    expect(pairs(MESSAGES.en).sort()).toEqual(Object.keys(CONVERTED).sort());
    expect(pairs(MESSAGES.zh)).toEqual([]);
  });

  for (const [path, count] of Object.entries(CONVERTED)) {
    it(`${path} has both English forms around its count`, () => {
      const en = at(MESSAGES.en, path) as CountMessage;
      const zh = at(MESSAGES.zh, path) as CountMessage;
      expect(isPair(en), `${path} in English`).toBe(true);
      if (!isPair(en)) return;
      // Two different forms with the same placeholders, among them the count; Chinese keeps the same placeholders.
      expect(en.one).not.toBe(en.other);
      expect(placeholders(en.one)).toEqual(placeholders(en.other));
      expect(placeholders(en.other)).toContain(count);
      expect(typeof zh).toBe("string");
      expect(placeholders(zh as string)).toEqual(placeholders(en.other));
      // A count of one reads the one form, any other count the other form.
      const values = (n: number) => Object.fromEntries(placeholders(en.other).map((name) => [name, name === count ? n : "X"]));
      expect(plural(en, 1, values(1))).toBe(tpl(en.one, values(1)));
      expect(plural(en, 2, values(2))).toBe(tpl(en.other, values(2)));
      expect(plural(en, 0, values(0))).toBe(tpl(en.other, values(0)));
    });
  }
});
