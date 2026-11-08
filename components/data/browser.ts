// Browser-only helpers for the data screens: the storage environment, file downloads and the backup export.

import { backupFileName, browserEnv, createBackup, readPrefCookies, readStorage, recordBackup, serializeBackup, type BackupEnv } from "@/lib/backup";
import { stringifyCsv, type CsvCell } from "@/lib/csv";

/** The real storage environment, or null when this browser blocks localStorage for the site. */
export function getEnv(): BackupEnv | null {
  try {
    const env = browserEnv();
    // Reading a property throws when storage is blocked (some privacy settings).
    void env.storage.length;
    return env;
  } catch {
    return null;
  }
}

/** Saves text as a file on this device (a Blob download; nothing is uploaded). */
export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download after the click returns, so the URL lives on for a while.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Saves rows as a CSV file. The byte order mark makes Excel read UTF-8 (Chinese names) correctly. */
export function downloadCsv(name: string, rows: ReadonlyArray<ReadonlyArray<CsvCell>>): void {
  downloadFile(name, `﻿${stringifyCsv(rows)}`, "text/csv;charset=utf-8");
}

/** Exports everything stored in this browser as a backup file and records the time. Returns the file name. */
export function exportBackupNow(now: Date = new Date()): string {
  const env = getEnv();
  const backup = createBackup(env ? readStorage(env.storage) : {}, readPrefCookies(document.cookie), now);
  const file = backupFileName(now);
  downloadFile(file, serializeBackup(backup), "application/json");
  recordBackup(now);
  return file;
}
