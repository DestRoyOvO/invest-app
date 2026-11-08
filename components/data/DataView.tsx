"use client";

import { useT } from "@/components/providers/PrefsProvider";

import { BackupPanel } from "./BackupPanel";
import { ClearDataPanel } from "./ClearDataPanel";
import { CsvImportPanel } from "./CsvImportPanel";
import { ExportCsvPanel } from "./ExportCsvPanel";
import { PastePanel } from "./PastePanel";
import { StoragePanel } from "./StoragePanel";

/**
 * /data (DATA): everything personal lives in this browser, so this page keeps it safe (backup, restore, CSV export,
 * clear) and makes moving in quick (paste positions, broker CSV import). Column flow: the wide workflows on the left,
 * the short panels on the right; on phones backup comes first, then the imports.
 */
export function DataView() {
  const t = useT();
  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <h1 className="sr-only">{t.data.title}</h1>
      <div className="flex min-w-0 flex-col gap-px">
        <BackupPanel />
        <div id="import" className="flex min-w-0 scroll-mt-2 flex-col gap-px">
          <PastePanel />
          <CsvImportPanel />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <StoragePanel />
        <ExportCsvPanel />
        <ClearDataPanel />
      </div>
    </div>
  );
}
