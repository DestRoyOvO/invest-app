"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";

import { anchorOnPage, followHash, hashId, landingFor, lastFragment, type Place } from "./hash-landing";

// What this page load knows about its navigations. Module state rather than component state: the root 404 page renders
// a shell of its own, and the shell that mounts next carries on where the other one stopped.

/** The first address of the page load while the router may put its hash in front of later ones (landingFor). */
let first: Place | null | undefined;
/** The address the last link click or command asked for, until the navigation it started lands. */
let intent: Place | null = null;
/** The address a Back or Forward press returned to, until its landing. */
let traversedTo: string | null = null;
/** The address handled last and the hash it landed on: an effect run again for it (Strict Mode) does not redo it. */
let handled: { href: string; hash: string } | null = null;
/** Stops following the target landed on last. */
let stopFollowing: (() => void) | null = null;

const placeOf = (url: URL | Location): Place => ({ pathname: url.pathname, search: url.search, hash: url.hash });

/** Remembers the hash a link or command asks for when it opens another page. */
function noteIntent(href: string) {
  const url = new URL(href, window.location.href);
  const here = window.location;
  if (url.origin !== here.origin || (url.pathname === here.pathname && url.search === here.search)) return;
  intent = placeOf(url);
}

/** The hash the link or command behind this navigation asked for, when that navigation led here. */
function takeIntent(at: Place): string | undefined {
  const asked = intent;
  intent = null;
  return asked && asked.pathname === at.pathname && asked.search === at.search ? asked.hash : undefined;
}

/**
 * Shows `hash` in the address bar instead of what the router wrote. The router keeps pushState and replaceState in
 * step with itself when the state passed is not its own, so after the first landing it takes the new address too.
 * During the first landing it has not hooked into history yet, and its entry state must be kept.
 */
function showHash(hash: string, firstLanding: boolean) {
  const { pathname, search } = window.location;
  window.history.replaceState(firstLanding ? window.history.state : null, "", `${pathname}${search}${hash}`);
}

/** The hash the navigation that led to this address asked for, with the address bar showing it. */
function resolveNavigation(): string {
  if (handled?.href === window.location.href) return handled.hash;
  const at = placeOf(window.location);
  const firstLanding = first === undefined;
  let hash: string;
  if (first === undefined) {
    // The address of a fresh load is the browser's own.
    first = at.hash ? at : null;
    hash = lastFragment(at.hash);
  } else {
    // React renders a Back or Forward press inside the popstate event, before listeners added after the router's run.
    const traversal = traversedTo === window.location.href || window.event?.type === "popstate";
    traversedTo = null;
    const landing = landingFor(at, first, takeIntent(at), traversal);
    first = landing.first;
    hash = landing.hash;
  }
  if (hash !== at.hash) showHash(hash, firstLanding);
  handled = { href: window.location.href, hash };
  return hash;
}

/** Lands on the element a hash names inside the scrolling area, and keeps it there while the page loads around it. */
function landOn(hash: string) {
  stopLanding();
  const main = document.getElementById("main");
  const id = hashId(hash);
  if (!main || !id) return;
  // The skip link (#main) and anything outside the scrolling area are the browser's.
  const target = document.getElementById(id);
  if (target && (target === main || !main.contains(target))) return;
  stopFollowing = followHash(main, id);
}

function stopLanding() {
  stopFollowing?.();
  stopFollowing = null;
}

/**
 * Opens an anchor on the page that is already open (PASTE on /data, RISK on the quote it shows). The history entry is
 * written directly, which the router follows, and announced with hashchange, which the landing and the page itself
 * (PASTE puts the cursor in its box) listen for: the router scrolls only when the hash changes, so the same code typed
 * twice would do nothing. Returns false when `href` is another page or names no anchor.
 */
export function openAnchorHere(href: string): boolean {
  const url = anchorOnPage(href, window.location.href);
  if (!url) return false;
  const oldURL = window.location.href;
  if (url.href !== oldURL) window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: url.href }));
  return true;
}

/** Opens an address from the command bar or a G key: an anchor on this page at once, another page through the router. */
export function openHref(router: { push(href: string): void }, href: string): void {
  if (openAnchorHere(href)) return;
  noteIntent(href);
  router.push(href);
}

/**
 * Lands on the element the URL hash names (NVDA RISK opens /stock/NVDA#risk) on a fresh load and after every
 * navigation that asked for one, and keeps it in place while the panels above it load (hash-landing.ts). Renders
 * nothing; the shell mounts it inside a Suspense boundary because it reads the search parameters.
 */
export function HashLanding() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // A layout effect, so the address is settled before the page's own effects read it (PastePanel looks for #paste).
  useLayoutEffect(() => {
    landOn(resolveNavigation());
    return stopLanding;
  }, [pathname, search]);

  useEffect(() => {
    // An anchor on this page: the skip link, a plain #paste link, openAnchorHere, or Back within the page.
    const onHashChange = (event: HashChangeEvent) => {
      // Back or Forward to another page changes the hash too: that page lands once it has rendered.
      const from = event.oldURL ? new URL(event.oldURL) : null;
      if (from && (from.pathname !== window.location.pathname || from.search !== window.location.search)) return;
      traversedTo = null;
      const hash = lastFragment(window.location.hash);
      // A fragment the browser went to by itself (the skip link, a plain #paste link, the address bar) is a history
      // entry without the router's state, and Back to it would leave the page as it was: the router adopts it here.
      if (hash !== window.location.hash || window.history.state === null) showHash(hash, false);
      handled = { href: window.location.href, hash };
      landOn(hash);
    };
    // For a router that renders the entry after the event (see resolveNavigation).
    const onPopState = () => {
      traversedTo = window.location.href;
    };
    // A link says where it leads before the router writes the address (see landingFor).
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link instanceof HTMLAnchorElement && (!link.target || link.target === "_self") && !link.hasAttribute("download")) noteIntent(link.href);
    };
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
