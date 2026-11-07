// Sector classification shared by the UI (portfolio exposure, screener) and the AI context, so both group a holding
// the same way: universe membership first, then Yahoo's sector name mapped onto the universe sectors.

import type { SectorKey } from "@/types/api";

import { sectorOfSymbol } from "./universe";

/** Yahoo (Morningstar-style) sector names mapped onto the universe sectors, so groups are not split by naming. */
export const YAHOO_SECTOR_KEYS: Readonly<Record<string, SectorKey>> = {
  technology: "technology",
  "communication services": "communication",
  "consumer cyclical": "consumer-discretionary",
  "consumer defensive": "consumer-staples",
  healthcare: "healthcare",
  "financial services": "financials",
  industrials: "industrials",
  energy: "energy",
  "basic materials": "materials",
  utilities: "utilities",
  "real estate": "real-estate",
};

/** Universe sector key for a Yahoo sector name such as "Consumer Cyclical"; undefined when it does not map. */
export function yahooSectorKey(name: string | null | undefined): SectorKey | undefined {
  return name ? YAHOO_SECTOR_KEYS[name.trim().toLowerCase()] : undefined;
}

/** Asset classes that are grouped by kind rather than by sector. */
export type AssetClassKey = "etf" | "crypto" | "index" | "future" | "currency";

const QUOTE_TYPE_CLASSES: Readonly<Record<string, AssetClassKey>> = {
  ETF: "etf",
  MUTUALFUND: "etf",
  CRYPTOCURRENCY: "crypto",
  INDEX: "index",
  FUTURE: "future",
  CURRENCY: "currency",
};

export type HoldingGroup =
  | { kind: "sector"; key: SectorKey }
  | { kind: "asset"; key: AssetClassKey }
  /** A Yahoo sector name that does not map onto the universe sectors. */
  | { kind: "other"; label: string }
  | { kind: "unclassified" };

/** How a holding is grouped for exposure: universe sector, asset class, mapped Yahoo sector, raw Yahoo sector. */
export function holdingGroup(symbol: string, quoteType: string | null, yahooSector: string | null): HoldingGroup {
  const universe = sectorOfSymbol(symbol);
  if (universe) return { kind: "sector", key: universe.key };
  const assetClass = quoteType ? QUOTE_TYPE_CLASSES[quoteType] : undefined;
  if (assetClass) return { kind: "asset", key: assetClass };
  const key = yahooSectorKey(yahooSector);
  if (key) return { kind: "sector", key };
  return yahooSector?.trim() ? { kind: "other", label: yahooSector.trim() } : { kind: "unclassified" };
}

/** Stable string id of a group, for maps and React keys. */
export function holdingGroupId(group: HoldingGroup): string {
  switch (group.kind) {
    case "sector":
    case "asset":
      return `${group.kind}:${group.key}`;
    case "other":
      return `other:${group.label.toLowerCase()}`;
    case "unclassified":
      return "unclassified";
  }
}
