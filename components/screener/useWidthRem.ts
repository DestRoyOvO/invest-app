"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * An element's content width in rem, for fitting table columns to it. Attach `ref`; `widthRem` is null until the element
 * mounts (and on the server), then follows resizes (the window, the filter rail) through a ResizeObserver, before the
 * next paint.
 */
export function useWidthRem<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!element) return () => {};
      const observer = new ResizeObserver(onChange);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [element],
  );
  const widthRem = useSyncExternalStore(
    subscribe,
    () => (element ? element.clientWidth / rootFontSize() : null),
    () => null,
  );
  return { ref: setElement, element, widthRem };
}
