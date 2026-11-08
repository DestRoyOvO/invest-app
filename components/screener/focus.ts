// Keyboard focus for controls that remove themselves or turn disabled when used (a filter chip, Clear all, a saved
// screen), so focus lands on a nearby control instead of falling back to the start of the page.

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";

/** On the page, enabled, rendered and in the tab order. */
function canFocus(el: HTMLElement): boolean {
  return el.isConnected && !el.matches(":disabled") && el.tabIndex >= 0 && el.getClientRects().length > 0;
}

/** Focuses the first candidate that can take focus. Returns whether one did. */
export function focusFirst(...candidates: Array<HTMLElement | null | undefined>): boolean {
  for (const el of candidates) {
    if (el && canFocus(el)) {
      el.focus();
      return true;
    }
  }
  return false;
}

/** The first element inside `root` that can take focus, in document order. */
export function firstFocusable(root: HTMLElement | null | undefined): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) if (canFocus(el)) return el;
  return null;
}

/** Scrolls a horizontal strip (the column-set tabs on a phone) so `el` is fully in view, without scrolling the page. */
export function revealInStrip(strip: HTMLElement, el: HTMLElement): void {
  const box = strip.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (rect.left < box.left) strip.scrollLeft -= box.left - rect.left;
  else if (rect.right > box.right) strip.scrollLeft += rect.right - box.right;
}
