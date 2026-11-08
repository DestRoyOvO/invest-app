// Landing on the element a URL hash names (/stock/NVDA#risk, /markets#rates, /data#paste) once the page has loaded
// around it. The router (or the browser, on a fresh load) scrolls to the element once, when the page mounts; but the
// panels above it fill in afterwards and push it down, or the page is still too short to scroll that far. So the
// element is followed and kept at the top of the scrolling area until it has stayed there for a moment (the browser's
// scroll anchoring holds it from then on) or for at most a few seconds. The reader always wins: following stops at once
// when they scroll, press a key or touch the page. `follow` is the loop with its browser parts passed in, so it is unit
// tested.

/** The longest a hash target is followed while the page above it loads. */
export const FOLLOW_MS = 8000;
/** Following ends once the target has sat at the top this long with nothing moving it. */
export const SETTLED_MS = 1500;

/** What reading or moving around looks like: any of these stops the following at once. */
const READER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** The element id in a location hash ("#risk" gives "risk"), or null for an empty or malformed hash. */
export function hashId(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

export interface FollowEnv {
  /** How far the target sits below where it should be (px, negative when above); null while it is not rendered. */
  offset(): number | null;
  /** Scrolls the area down by `delta` pixels (up when negative); the browser stops it at either end. */
  scrollBy(delta: number): void;
  /** Runs the callback on the next frame; returns a function that cancels it. */
  frame(callback: () => void): () => void;
  now(): number;
}

/**
 * Keeps the target in place every frame, and ends (calling `onEnd`) once it has stayed at the top for `settled` ms, or
 * after `duration` ms. A target that cannot reach the top yet (the page is still too short) or is not rendered yet is
 * not settled. Returns a function that stops it early, without calling `onEnd`.
 */
export function follow(env: FollowEnv, { duration = FOLLOW_MS, settled = SETTLED_MS }: { duration?: number; settled?: number } = {}, onEnd?: () => void): () => void {
  const start = env.now();
  let stopped = false;
  let cancel: (() => void) | null = null;
  /** Since when the target has been at the top without needing a scroll; null while it is not. */
  let restingSince: number | null = null;
  const tick = () => {
    if (stopped) return;
    const now = env.now();
    let offset = env.offset();
    // Sub-pixel differences are layout rounding, not a shift.
    if (offset !== null && Math.abs(offset) >= 1) {
      env.scrollBy(offset);
      offset = env.offset();
      restingSince = null;
    } else if (offset !== null) {
      restingSince ??= now;
    }
    // Still below the top after scrolling: the page cannot scroll that far yet.
    if (offset === null || Math.abs(offset) >= 1) restingSince = null;
    if (now - start >= duration || (restingSince !== null && now - restingSince >= settled)) {
      stopped = true;
      onEnd?.();
      return;
    }
    cancel = env.frame(tick);
  };
  tick();
  return () => {
    stopped = true;
    cancel?.();
  };
}

/** Follows the element with this id inside the scrolling area `main` (browser only). Returns a stop function. */
export function followHash(main: HTMLElement, id: string): () => void {
  const listen = (on: boolean) => {
    for (const type of READER_EVENTS) {
      if (on) window.addEventListener(type, stop, { capture: true, passive: true });
      else window.removeEventListener(type, stop, true);
    }
  };
  listen(true);
  const stopFollowing = follow(
    {
      offset() {
        const target = document.getElementById(id);
        // Not there yet, outside the scrolling area, or not rendered (display: none has no boxes).
        if (!target || target === main || !main.contains(target) || target.getClientRects().length === 0) return null;
        const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
        return target.getBoundingClientRect().top - main.getBoundingClientRect().top - margin;
      },
      scrollBy(delta) {
        main.scrollTop += delta;
      },
      frame(callback) {
        const handle = window.requestAnimationFrame(callback);
        return () => window.cancelAnimationFrame(handle);
      },
      now: () => performance.now(),
    },
    {},
    () => listen(false),
  );
  function stop() {
    stopFollowing();
    listen(false);
  }
  return stop;
}
