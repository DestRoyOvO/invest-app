"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { followHash, hashId } from "./hash-landing";

function land(): (() => void) | undefined {
  const main = document.getElementById("main");
  const id = hashId(window.location.hash);
  return main && id ? followHash(main, id) : undefined;
}

/**
 * Lands on the element the URL hash names (NVDA RISK opens /stock/NVDA#risk) after every navigation and on a fresh
 * load, and keeps it in place while the panels above it load (hash-landing.ts). Renders nothing; the shell mounts it
 * inside a Suspense boundary because it reads the search parameters.
 */
export function HashLanding() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => land(), [pathname, search]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    const onHashChange = () => {
      stop?.();
      stop = land();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      stop?.();
    };
  }, []);

  return null;
}
