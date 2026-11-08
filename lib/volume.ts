// Volume figures shared by the overview (heatmap card, movers) and the screener (Discover). Pure; tested in
// volume.test.ts.

/** Today's volume as a multiple of the 3-month daily average; null without both numbers or with a zero average. */
export function relativeVolume(volume: number | null | undefined, averageVolume: number | null | undefined): number | null {
  if (typeof volume !== "number" || typeof averageVolume !== "number" || !Number.isFinite(volume) || !Number.isFinite(averageVolume)) return null;
  return averageVolume > 0 && volume >= 0 ? volume / averageVolume : null;
}
