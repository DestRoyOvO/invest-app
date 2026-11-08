"use client";

import { useCallback, useEffect, useRef } from "react";

/** How long after a bare "g" the shell waits for the second key of a "g" sequence (TerminalShell uses 1.2 s). */
const G_SEQUENCE_MS = 1200;

/**
 * Page shortcuts on the quote page (a, p, n, w, l ...) share letters with the shell's "g" sequences ("g w" opens the
 * watchlist). This watches keydown in the capture phase, before any handler, and returns a check that is true while
 * a "g" sequence may be in progress, so page hotkeys can stand aside (`when: () => !inGSequence()`).
 */
export function useGSequenceGuard(): () => boolean {
  const lastG = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.key === "g" || event.key === "G") lastG.current = Date.now();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  return useCallback(() => Date.now() - lastG.current < G_SEQUENCE_MS, []);
}
