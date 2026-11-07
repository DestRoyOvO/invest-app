"use client";

import { useCallback } from "react";

import { useLocalStore } from "@/hooks/useLocalStore";
import { removeSavedScreen, restoreSavedScreen, screensStore, upsertSavedScreen, type SavedScreen, type SaveScreenResult, type Screen } from "@/lib/screens";

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The investor's saved screens (lib/screens.ts, investseek:screens:v1, up to 30), newest first. Every change re-reads
 * storage first, so a save in one tab never drops a screen saved in another.
 */
export function useSavedScreens() {
  const screens = useLocalStore(screensStore);

  const save = useCallback((name: string, screen: Screen): SaveScreenResult => {
    let result: SaveScreenResult = "invalid";
    screensStore.update((current) => {
      const next = upsertSavedScreen(current, { id: newId(), name, screen, savedAt: new Date().toISOString() });
      result = next.result;
      return next.list;
    });
    return result;
  }, []);

  /** Deletes a screen and returns it with its position, for an undo. */
  const remove = useCallback((id: string): { entry: SavedScreen; index: number } | null => {
    let removed: { entry: SavedScreen; index: number } | null = null;
    screensStore.update((current) => {
      const index = current.findIndex((s) => s.id === id);
      if (index >= 0) removed = { entry: current[index], index };
      return removeSavedScreen(current, id);
    });
    return removed;
  }, []);

  const restore = useCallback((entry: SavedScreen, index: number) => {
    screensStore.update((current) => restoreSavedScreen(current, entry, index));
  }, []);

  return { screens, save, remove, restore };
}
