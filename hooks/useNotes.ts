"use client";

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
