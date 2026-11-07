import type { Messages } from "@/lib/i18n/messages";
import type { AssetClass } from "@/lib/portfolio-analytics";
import type { HoldingGroup } from "@/lib/sectors";
import { getSector } from "@/lib/universe";
import type { Lang } from "@/types/api";

/** Display name of an exposure group: the universe sector, an asset class, Yahoo's own sector name, or Unclassified. */
export function holdingGroupLabel(group: HoldingGroup, t: Messages, lang: Lang, short = false): string {
  switch (group.kind) {
    case "sector": {
      const sector = getSector(group.key);
      return sector ? (short ? sector.short[lang] : sector.label[lang]) : group.key;
    }
    case "asset":
      return t.port.exposure.assetGroups[group.key];
    case "other":
      return group.label;
    case "unclassified":
      return t.port.exposure.unclassified;
  }
}

export function assetClassLabel(key: AssetClass, t: Messages): string {
  return t.port.exposure.classes[key];
}

/** Categorical series colors for slices (identity only, never direction); the last one is the neutral rest. */
export const SLICE_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"] as const;
export const REST_COLOR = "var(--series-6)";
