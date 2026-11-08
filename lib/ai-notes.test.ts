import { describe, expect, it } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { assetClassOf, NOTE_OUTLINES, noteOutline, noteSpecId, type SectionKey } from "./ai-notes";

describe("note structure", () => {
  it("maps quote types to asset classes", () => {
    expect(assetClassOf("EQUITY")).toBe("equity");
    expect(assetClassOf("ETF")).toBe("fund");
    expect(assetClassOf("MUTUALFUND")).toBe("fund");
    expect(assetClassOf("CRYPTOCURRENCY")).toBe("crypto");
    expect(assetClassOf("FUTURE")).toBe("futures");
    expect(assetClassOf("CURRENCY")).toBe("currency");
    expect(assetClassOf("INDEX")).toBe("index");
    expect(assetClassOf(null)).toBe("equity");
    expect(assetClassOf("SOMETHING_NEW")).toBe("equity");
  });

  it("picks the note structure by kind, and by asset class for stock notes only", () => {
    expect(noteSpecId("stock")).toBe("equity");
    expect(noteSpecId("stock", "fund")).toBe("fund");
    expect(noteSpecId("stock", "crypto")).toBe("priceOnly");
    expect(noteSpecId("stock", "futures")).toBe("priceOnly");
    expect(noteSpecId("stock", "currency")).toBe("priceOnly");
    expect(noteSpecId("stock", "index")).toBe("index");
    expect(noteSpecId("market", "fund")).toBe("market");
    expect(noteSpecId("move")).toBe("move");
    expect(noteOutline("move")).toEqual(["whatMoved", "marketSector", "companySpecific", "howUnusual", "whatToWatch"]);
    expect(noteOutline("stock", "fund")).not.toContain("valuation");
    expect(noteOutline("stock", "crypto")).not.toContain("valuation");
  });

  it("has a heading in both languages for every section", () => {
    const keys = new Set<SectionKey>([...Object.values(NOTE_OUTLINES).flat(), "intoReport"]);
    for (const key of keys) {
      expect(MESSAGES.en.ai.sections[key]).toBeTruthy();
      expect(MESSAGES.zh.ai.sections[key]).toMatch(/[一-鿿]/);
    }
  });
});
