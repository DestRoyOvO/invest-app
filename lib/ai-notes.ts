// The structure of every AI research note: which sections it has, in which order, per note kind and asset class.
// Shared by the server prompts (lib/server/prompts.ts adds what each section should contain) and the idle note panel,
// which shows the same outline before anything is generated. Section headings live in lib/i18n (ai.sections), so the
// headings the model is told to write and the outline the reader sees are the same strings.

import type { AnalyzeKind } from "@/types/api";

/** How a symbol is treated: companies get fundamentals and earnings, funds their holdings, the rest price action. */
export type AssetClass = "equity" | "fund" | "crypto" | "futures" | "currency" | "index";

/** Asset class of a Yahoo quote type; anything unknown is treated as a company. */
export function assetClassOf(quoteType: string | null | undefined): AssetClass {
  switch (quoteType) {
    case "ETF":
    case "MUTUALFUND":
      return "fund";
    case "CRYPTOCURRENCY":
      return "crypto";
    case "FUTURE":
      return "futures";
    case "CURRENCY":
      return "currency";
    case "INDEX":
      return "index";
    default:
      return "equity";
  }
}

export type SectionKey =
  | "bottomLine"
  | "bullCase"
  | "bearCase"
  | "valuation"
  | "technical"
  | "whatToWatch"
  | "intoReport"
  | "quantFacts"
  | "holdings"
  | "performance"
  | "costStructure"
  | "risks"
  | "priceAction"
  | "drivers"
  | "levelTrend"
  | "indices"
  | "crossAsset"
  | "rotation"
  | "headlines"
  | "relative"
  | "leaders"
  | "sectorDrivers"
  | "sessionMoves"
  | "concentration"
  | "valuationMix"
  | "keyRisks"
  | "whatHappened"
  | "whyMatters"
  | "whoAffected"
  | "signalNoise"
  | "whatMoved"
  | "marketSector"
  | "companySpecific"
  | "howUnusual";

/** One prompt and outline per note kind, and per asset class for single-symbol notes. */
export type NoteSpecId = "equity" | "fund" | "priceOnly" | "index" | "market" | "sector" | "watchlist" | "news" | "move";

export const NOTE_OUTLINES: Readonly<Record<NoteSpecId, readonly SectionKey[]>> = {
  equity: ["bottomLine", "bullCase", "bearCase", "valuation", "technical", "whatToWatch", "quantFacts"],
  fund: ["bottomLine", "holdings", "performance", "costStructure", "risks", "whatToWatch"],
  priceOnly: ["bottomLine", "priceAction", "drivers", "risks", "whatToWatch"],
  index: ["bottomLine", "levelTrend", "drivers", "risks", "whatToWatch"],
  market: ["bottomLine", "indices", "crossAsset", "rotation", "headlines", "whatToWatch"],
  sector: ["bottomLine", "relative", "leaders", "sectorDrivers", "risks", "whatToWatch"],
  watchlist: ["bottomLine", "sessionMoves", "concentration", "valuationMix", "keyRisks", "whatToWatch"],
  news: ["whatHappened", "whyMatters", "whoAffected", "signalNoise", "whatToWatch"],
  move: ["whatMoved", "marketSector", "companySpecific", "howUnusual", "whatToWatch"],
};

/** The equity note adds this section after "What to watch" when the next report is at most this many days away. */
export const INTO_REPORT_DAYS = 14;

/** Which note structure a request gets. Only the stock note depends on the asset class. */
export function noteSpecId(kind: AnalyzeKind, asset: AssetClass = "equity"): NoteSpecId {
  if (kind !== "stock") return kind;
  switch (asset) {
    case "fund":
      return "fund";
    case "index":
      return "index";
    case "crypto":
    case "futures":
    case "currency":
      return "priceOnly";
    default:
      return "equity";
  }
}

/** The sections a note will contain, in order (the conditional "Into the report" section is not listed). */
export function noteOutline(kind: AnalyzeKind, asset: AssetClass = "equity"): readonly SectionKey[] {
  return NOTE_OUTLINES[noteSpecId(kind, asset)];
}
