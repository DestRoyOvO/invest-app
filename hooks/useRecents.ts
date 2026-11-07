"use client";

import { useSyncExternalStore } from "react";

import { createLocalStore } from "@/lib/local-store";
import { normalizeSymbol } from "@/lib/symbols";
import { SECTOR_KEYS } from "@/lib/universe";

// Where the reader has been: the last 8 quotes opened (the command bar's Recent section) and the last sector (the SECT
// function and the Sectors navigation item). Both live in this browser only and sync across tabs (lib/local-store.ts).
// Quote pages record visits through rememberSymbol in hooks/useLastSymbol.ts; the shell records sector visits.

export const RECENTS_STORAGE_KEY = "investseek:recents:v1";
export const LAST_SECTOR_STORAGE_KEY = "investseek:last-sector:v1";
export const MAX_RECENTS = 8;

const NO_RECENTS: readonly string[] = [];

/** Turns stored or imported data into a valid list: normalized, unique symbols, newest first, at most MAX_RECENTS. */
export function sanitizeRecents(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return NO_RECENTS;
  const out: string[] = [];
  for (const item of raw) {
    const symbol = normalizeSymbol(item);
    if (symbol && !out.includes(symbol)) out.push(symbol);
    if (out.length >= MAX_RECENTS) break;
  }
  return out;
}

/** The list with `symbol` moved (or added) to the front, capped at `max`. */
export function pushRecent(list: readonly string[], symbol: string, max = MAX_RECENTS): string[] {
  return [symbol, ...list.filter((s) => s !== symbol)].slice(0, max);
}

export const recentsStore = createLocalStore<readonly string[]>({ key: RECENTS_STORAGE_KEY, sanitize: sanitizeRecents, empty: NO_RECENTS });

/** Records a quote visit. Invalid symbols are ignored; revisiting the newest symbol writes nothing. */
export function addRecent(input: string): void {
  const symbol = normalizeSymbol(input);
  if (!symbol || recentsStore.getSnapshot()[0] === symbol) return;
  recentsStore.update((list) => pushRecent(list, symbol));
}

/** The last quotes opened, newest first (empty on the server). */
export function useRecents(): readonly string[] {
  return useSyncExternalStore(recentsStore.subscribe, recentsStore.getSnapshot, recentsStore.getServerSnapshot);
}

export function sanitizeSector(raw: unknown): string | null {
  return typeof raw === "string" && (SECTOR_KEYS as readonly string[]).includes(raw) ? raw : null;
}

export const lastSectorStore = createLocalStore<string | null>({ key: LAST_SECTOR_STORAGE_KEY, sanitize: sanitizeSector, empty: null });

/** Records the sector page the reader opened; unknown keys are ignored. */
export function rememberSector(key: string): void {
  const sector = sanitizeSector(key);
  if (sector && lastSectorStore.getSnapshot() !== sector) lastSectorStore.write(sector);
}

/** The last sector opened, or null (also on the server). */
export function useLastSector(): string | null {
  return useSyncExternalStore(lastSectorStore.subscribe, lastSectorStore.getSnapshot, lastSectorStore.getServerSnapshot);
}
