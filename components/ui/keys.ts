// Keyboard helpers shared by the composite widgets (tabs, segmented controls), kept free of React so they can be tested.

export type Orientation = "horizontal" | "vertical" | "both";

const NEXT: Record<Orientation, string[]> = { horizontal: ["ArrowRight"], vertical: ["ArrowDown"], both: ["ArrowRight", "ArrowDown"] };
const PREVIOUS: Record<Orientation, string[]> = { horizontal: ["ArrowLeft"], vertical: ["ArrowUp"], both: ["ArrowLeft", "ArrowUp"] };

/**
 * Next index for arrow-key movement inside a group with one tab stop (WAI-ARIA tabs and radio groups): arrows wrap
 * around, Home and End jump to the ends. Returns null for keys the group does not handle.
 */
export function rovingIndex(key: string, index: number, count: number, orientation: Orientation = "horizontal"): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (NEXT[orientation].includes(key)) return (index + 1) % count;
  if (PREVIOUS[orientation].includes(key)) return (index - 1 + count) % count;
  return null;
}
