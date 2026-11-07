// Positioning for hover cards and tooltips (no library): pick a side that fits, then keep the box inside the viewport.

export type Side = "top" | "bottom" | "left" | "right";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface FloatingPosition {
  x: number;
  y: number;
  side: Side;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function clamp(value: number, min: number, max: number): number {
  // A box larger than the viewport pins to the start edge rather than overflowing both.
  return max < min ? min : Math.min(Math.max(value, min), max);
}

/**
 * Places a floating box next to an anchor (viewport coordinates, as from getBoundingClientRect). It uses the preferred
 * side when the box fits there, otherwise the opposite side when that has more room, centers the box on the anchor
 * along the other axis and clamps it to the viewport, keeping `margin` pixels clear of every edge.
 */
export function placeFloating(
  anchor: Box,
  floating: Size,
  viewport: Size,
  preferred: Side = "bottom",
  { offset = 6, margin = 8 }: { offset?: number; margin?: number } = {},
): FloatingPosition {
  const space: Record<Side, number> = {
    top: anchor.y - margin,
    bottom: viewport.height - (anchor.y + anchor.height) - margin,
    left: anchor.x - margin,
    right: viewport.width - (anchor.x + anchor.width) - margin,
  };
  const needed = (side: Side) => (side === "top" || side === "bottom" ? floating.height : floating.width) + offset;

  let side = preferred;
  if (space[side] < needed(side) && space[OPPOSITE[side]] > space[side]) side = OPPOSITE[side];

  let x: number;
  let y: number;
  if (side === "top" || side === "bottom") {
    x = anchor.x + anchor.width / 2 - floating.width / 2;
    y = side === "bottom" ? anchor.y + anchor.height + offset : anchor.y - offset - floating.height;
  } else {
    x = side === "right" ? anchor.x + anchor.width + offset : anchor.x - offset - floating.width;
    y = anchor.y + anchor.height / 2 - floating.height / 2;
  }
  return {
    x: clamp(x, margin, viewport.width - floating.width - margin),
    y: clamp(y, margin, viewport.height - floating.height - margin),
    side,
  };
}
