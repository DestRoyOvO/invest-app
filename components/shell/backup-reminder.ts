"use client";

import { useMemo, useSyncExternalStore } from "react";

import { useLocalStore } from "@/hooks/useLocalStore";
import { backupDue, backupMetaStore, hasPersonalData, PERSONAL_DATA_KEYS, readPersonalData, type BackupReminder, type StorageSnapshot } from "@/lib/backup";
import { registeredLocalStores } from "@/lib/local-store";

import { useNow } from "./clock";

// Keeps the backup reminder (lib/backup.ts) current in the open page. Only the personal-data keys are read, so the
// shell never parses view settings or browsing history on a render, and lib/backup.ts loads zod only when a backup
// file is checked, never for the reminder.

const NOTHING: StorageSnapshot = {};
let cached: StorageSnapshot | null = null;

function sameSnapshot(a: StorageSnapshot, b: StorageSnapshot): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function readSnapshot(): StorageSnapshot {
  try {
    const fresh = readPersonalData(window.localStorage);
    if (cached && sameSnapshot(cached, fresh)) return cached;
    cached = fresh;
    return fresh;
  } catch {
    // Storage is blocked: nothing is kept that a backup could save.
    return NOTHING;
  }
}

/**
 * Other tabs, restores, imports and Clear all data announce changes with storage events; edits in this tab go through
 * the stores, which tell their subscribers. A store registered after this subscribed (saved screens, once /screener
 * loads) is read again on the next render, at the latest when the 30-second clock ticks.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  const stores = registeredLocalStores();
  const unsubscribers = PERSONAL_DATA_KEYS.flatMap((key) => {
    const store = stores.get(key);
    return store ? [store.subscribe(onChange)] : [];
  });
  return () => {
    window.removeEventListener("storage", onChange);
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

const serverSnapshot = () => null;

/**
 * The backup reminder while one is due: this browser holds personal data and its last backup is more than 30 days old
 * or never happened (backupReminder in lib/backup.ts). Null otherwise, on the server and while hydrating. An export,
 * or a restore of a file that holds all the personal data, records the backup in backupMetaStore, which clears it at
 * once, in every tab.
 */
export function useBackupReminder(): BackupReminder | null {
  const snapshot = useSyncExternalStore<StorageSnapshot | null>(subscribe, readSnapshot, serverSnapshot);
  const { lastBackupAt } = useLocalStore(backupMetaStore);
  const now = useNow("halfMinute");
  const personal = useMemo(() => snapshot !== null && hasPersonalData(snapshot), [snapshot]);
  if (!personal || now === null) return null;
  return backupDue(lastBackupAt, new Date(now));
}
