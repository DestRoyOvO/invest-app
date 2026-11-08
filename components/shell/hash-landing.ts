// Landing on the element a URL hash names (/stock/NVDA#risk, /markets#rates, /data#paste) once the page has loaded
// around it. The router (or the browser, on a fresh load) scrolls to the element once, when the page mounts; but the
// panels above it fill in afterwards and push it down, or the page is still too short to scroll that far. So the
// element is followed and kept at the top of the scrolling area until it has stayed there for a moment (the browser's
// scroll anchoring holds it from then on) or for at most a few seconds. The reader always wins: following stops at once
// when they scroll, press a key or touch the page. `follow` is the loop with its browser parts passed in, so it is unit
// tested.
//
// The hash in the address bar is not always the hash a navigation asked for. Next 16.4 keeps the address of the page
// loaded first together with its hash, and builds later addresses of that page from it for as long as it keeps that
// route entry (five minutes in production): after a fresh /stock/NVDA#risk, a plain link to /stock/NVDA writes
// /stock/NVDA#risk, and /stock/NVDA#chart writes /stock/NVDA#risk#chart. Other search parameters on that path get the
// same prefix when the first address had none. `landingFor` works out what was asked for, so HashLanding lands only
// there and puts that address back in the bar. (The router stores `createHrefFromUrl(location)` with the hash in
// create-initial-router-state.js; every later entry is stored without one.)

/** The longest a hash target is followed while the page above it loads. */
export const FOLLOW_MS = 8000;
/** Following ends once the target has sat at the top this long with nothing moving it. */
export const SETTLED_MS = 1500;
/** Where a target lands below the top of the scrolling area when it sets no scroll-margin-top (scroll-mt-2). */
export const LANDING_MARGIN = 8;

/** What reading or moving around looks like: any of these stops the following at once. */
const READER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** The last fragment of a location hash: "#risk#chart" gives "#chart", "#risk" and "" stay as they are. */
export function lastFragment(hash: string): string {
  const at = hash.lastIndexOf("#");
  return at > 0 ? hash.slice(at) : hash;
}

/**
 * The element id in a location hash ("#risk" gives "risk", and "#risk#chart" gives "chart": see landingFor), or null
 * for an empty or malformed hash.
 */
export function hashId(hash: string): string | null {
  const last = lastFragment(hash);
  const raw = last.startsWith("#") ? last.slice(1) : last;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

/** An address as the location shows it. */
export interface Place {
  pathname: string;
  search: string;
  hash: string;
}

export interface Landing {
  /** The hash the navigation asked for, "" for none: the address bar shows it and the page lands on it. */
  hash: string;
  /** The first address of the page load for as long as the router may still put its hash in front of later ones. */
  first: Place | null;
}

/**
 * What a client navigation asked for, from the address the router wrote (`at`).
 *
 * - `first` is the first address of the page load, when it had a hash and the router may still prefix that hash.
 * - `asked` is the hash of the link or command that started the navigation, when that is known: it wins.
 * - Otherwise the last fragment is what was asked for, and the first hash alone means nothing was (a plain link).
 * - An address of the first page that shows the router writing exactly what was asked for, or a hash that does not
 *   start with the first one, means the router has dropped that entry: the first address is forgotten.
 * - A history traversal returns to an entry as it was written, so nothing is stripped or learned.
 */
export function landingFor(at: Place, first: Place | null, asked?: string, traversal = false): Landing {
  if (traversal || first === null || at.pathname !== first.pathname || (at.search !== first.search && first.search !== "")) {
    return { hash: !traversal && asked !== undefined ? asked : lastFragment(at.hash), first };
  }
  // Only the first address itself tells whether its entry is still there; another search may have had its own entry.
  const exact = at.search === first.search;
  if (asked !== undefined) return { hash: asked, first: exact && at.hash === asked ? null : first };
  if (at.hash === first.hash) return { hash: "", first };
  return { hash: lastFragment(at.hash), first: exact && !at.hash.startsWith(`${first.hash}#`) ? null : first };
}

/**
 * The address `href` points to when it is an anchor on the page at `here` (same origin, path and search, with a
 * hash), or null when it opens another page or names no anchor.
 */
export function anchorOnPage(href: string, here: string): URL | null {
  const url = new URL(href, here);
  const current = new URL(here);
  return url.hash.length > 1 && url.origin === current.origin && url.pathname === current.pathname && url.search === current.search ? url : null;
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
 * Keeps the target in place every frame, and ends (calling `onEnd`) once it has stayed at rest for `settled` ms, or
 * after `duration` ms. At rest means in place, or above its place with the area already scrolled to the top (only
 * the content above growing can move it then). A target that cannot reach its place yet (the page is still too
 * short) or is not rendered yet is not at rest. Returns a function that stops it early, without calling `onEnd`.
 */
export function follow(env: FollowEnv, { duration = FOLLOW_MS, settled = SETTLED_MS }: { duration?: number; settled?: number } = {}, onEnd?: () => void): () => void {
  const start = env.now();
  let stopped = false;
  let cancel: (() => void) | null = null;
  /** Since when the target has been at rest; null while it is not. */
  let restingSince: number | null = null;
  const tick = () => {
    if (stopped) return;
    const now = env.now();
    const offset = env.offset();
    let resting = false;
    if (offset !== null) {
      // Sub-pixel differences are layout rounding, not a shift.
      if (Math.abs(offset) < 1) resting = true;
      else {
        env.scrollBy(offset);
        const after = env.offset();
        // Still above its place and the scroll did not move: the area is at its top. (Still below it after
        // scrolling means the page cannot scroll that far yet.)
        resting = after !== null && after < 0 && Math.abs(after - offset) < 1;
      }
    }
    if (resting) restingSince ??= now;
    else restingSince = null;
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
        const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || LANDING_MARGIN;
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
