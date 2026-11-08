import type { Messages } from "@/lib/i18n/messages";
import { foldSlices, type AssetClass, type ExposureSlice } from "@/lib/portfolio-analytics";
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
/** Most legend entries: one per series color, the neutral series-6 included. */
export const MAX_LEGEND = SLICE_COLORS.length + 1;

export interface LegendEntry<K> {
  id: string;
  /** The group, or null for the folded rest ("Other"). */
  key: K | null;
  value: number;
  weight: number;
  color: string;
}

/**
 * Legend entries for an allocation bar, every one in its own series color (colors are identity, so they never
 * repeat): up to five groups in series 1 to 5, then either a sixth group or the rest folded into "Other", both in the
 * neutral series 6.
 */
export function allocationLegend<K>(slices: readonly ExposureSlice<K>[]): LegendEntry<K>[] {
  const { shown, rest } = foldSlices(slices, MAX_LEGEND);
  return [
    ...shown.map((s, i) => ({ id: s.id, key: s.key, value: s.value, weight: s.weight, color: SLICE_COLORS[i] ?? REST_COLOR })),
    ...(rest ? [{ id: "rest", key: null, value: rest.value, weight: rest.weight, color: REST_COLOR }] : []),
  ];
}
