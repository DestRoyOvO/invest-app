"use client";

import { useEffect, useRef, useState } from "react";

interface DraftOptions<T> {
  /** Quiet time after the last change before the draft is written. */
  delay?: number;
  equal?: (a: T, b: T) => boolean;
}

export interface Draft<T> {
  draft: T;
  setDraft: (value: T) => void;
  /** True while a change waits to be written. */
  dirty: boolean;
  /** Writes a waiting change now (on blur or Enter). */
  flush: () => void;
}

/**
 * A local draft of a stored value with debounced autosave: typing stays fast and never fights the store, a change is
 * written after `delay` ms without typing, on flush() and when the component unmounts. While nothing is waiting, a
 * change to the stored value (another tab, an import) replaces the draft.
 */
export function useDraft<T>(stored: T, save: (value: T) => void, { delay = 800, equal = Object.is }: DraftOptions<T> = {}): Draft<T> {
  const [draft, setDraftState] = useState(stored);
  const [dirty, setDirty] = useState(false);
  const [base, setBase] = useState(stored);
  if (!equal(stored, base)) {
    setBase(stored);
    if (!dirty) setDraftState(stored);
  }

  const latest = useRef({ draft, dirty, save });
  useEffect(() => {
    latest.current = { draft, dirty, save };
  });

  useEffect(() => {
    if (!dirty) return;
    const id = window.setTimeout(() => {
      latest.current.save(latest.current.draft);
      setDirty(false);
    }, delay);
    return () => window.clearTimeout(id);
  }, [draft, dirty, delay]);

  // Unmounting (leaving the page, switching symbols) writes what is still waiting.
  useEffect(
    () => () => {
      if (latest.current.dirty) latest.current.save(latest.current.draft);
    },
    [],
  );

  return {
    draft,
    dirty,
    setDraft: (value) => {
      setDraftState(value);
      setDirty(true);
    },
    flush: () => {
      if (!dirty) return;
      save(draft);
      setDirty(false);
    },
  };
}
