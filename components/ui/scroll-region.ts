import { useEffect, useState, type RefObject } from "react";

// A scroll box that keyboard users can reach: while its content overflows it is a named region with a tab stop, so the
// arrow keys scroll it (WCAG 2.1.1); while everything fits it stays a plain wrapper and adds no tab stop. DataTable uses
// it for its scroll wrapper.

export interface ScrollMetrics {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/** True for the computed overflow values that let a box scroll (visible, hidden and clip do not). */
export function isScrollable(overflow: string): boolean {
  return overflow === "auto" || overflow === "scroll";
}

/**
 * Whether a box scrolls on either axis: its content is larger than its client area on an axis whose overflow scrolls.
 * A pixel of slack absorbs sub-pixel rounding. A box whose overflow a caller turned off (overflow-x-visible!) never
 * counts, even though its content is wider.
 */
export function overflowsScrollBox(metrics: ScrollMetrics, overflowX: string, overflowY: string): boolean {
  const wide = isScrollable(overflowX) && metrics.scrollWidth > metrics.clientWidth + 1;
  const tall = isScrollable(overflowY) && metrics.scrollHeight > metrics.clientHeight + 1;
  return wide || tall;
}

export interface ScrollRegionProps {
  role?: "region";
  "aria-label"?: string;
  tabIndex?: 0;
}

/** The attributes of a scroll box: a named region with a tab stop while it overflows, nothing while everything fits. */
export function scrollRegionProps(overflowing: boolean, label: string): ScrollRegionProps {
  return overflowing ? { role: "region", "aria-label": label, tabIndex: 0 } : {};
}

/**
 * Props for a scroll box element (see scrollRegionProps). Measures after mounting, so the server render and the first
 * client render never add a tab stop, then watches the box and its first child (the table) for size changes.
 */
export function useScrollRegion(ref: RefObject<HTMLElement | null>, label: string): ScrollRegionProps {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setOverflowing(overflowsScrollBox(element, style.overflowX, style.overflowY));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);

  return scrollRegionProps(overflowing, label);
}
