"use client";

import { useEffect, useState } from "react";

import { useLocalStore } from "@/hooks/useLocalStore";
import { notesStore, type NotesBook, type SymbolNote } from "@/lib/notes";

/** All thesis notes (lib/notes.ts). */
export function useNotes(): NotesBook {
  return useLocalStore(notesStore);
}

/** One symbol's note, or undefined. */
export function useNote(symbol: string | null): SymbolNote | undefined {
  const book = useNotes();
  return symbol ? book[symbol] : undefined;
}

/**
 * The current time, refreshed every `intervalMs`. Null until the component has mounted, so the server render and the
 * first client render agree; date-relative text (days left, overdue) renders after that.
 */
export function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
