"use client";

import { Database, Download, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useId } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { useBackupReminder } from "@/components/shell/backup-reminder";
import { openAnchorOnClick } from "@/components/shell/HashLanding";
import { useToast } from "@/components/ui/Toast";
import { useLocalStore } from "@/hooks/useLocalStore";
import { backupAgeDays, backupMetaStore } from "@/lib/backup";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";

import { lastBackupLabel } from "./labels";

/**
 * The export code (./browser and the CSV writer) loads when the menu opens, not with every page: this section is
 * mounted in the settings menu of the whole app.
 */
const loadExport = () => import("./browser");

const ITEM =
  "flex h-7 w-full items-center gap-2 rounded-xs px-1.5 text-left text-xs text-fg transition-colors hover:bg-hover focus-visible:outline-offset-[-2px] max-sm:h-10";

/**
 * "Your data" in the settings menu: export a backup at once, or go to the import and data management page. The last
 * backup turns to the caveat color while a backup is due (the status bar's reminder, which phones do not have).
 */
export function DataMenuSection({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const toast = useToast();
  const headingId = useId();
  const meta = useLocalStore(backupMetaStore);
  const due = useBackupReminder() !== null;

  // Fetched as soon as the menu shows this section, so a click on Export downloads at once.
  useEffect(() => {
    loadExport().catch(() => {});
  }, []);

  const onExport = async () => {
    try {
      const { exportBackupNow } = await loadExport();
      toast.show({ message: tpl(t.data.backup.exported, { file: exportBackupNow() }) });
    } catch {
      toast.show({ message: t.data.backup.exportFailed });
    }
    onNavigate?.();
  };

  return (
    <section aria-labelledby={headingId} className="border-t border-line pt-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-xs font-medium text-fg-2">
          {t.data.menu.title}
        </h3>
        <span className={cn("truncate text-micro", due ? "text-warn" : "text-fg-3")}>{lastBackupLabel(t, backupAgeDays(meta.lastBackupAt))}</span>
      </div>
      <ul className="-mx-1.5">
        <li>
          <button type="button" onClick={() => void onExport()} className={ITEM}>
            <Download aria-hidden className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} />
            {t.data.menu.export}
          </button>
        </li>
        <li>
          <Link
            href="/data#import"
            onClick={(event) => {
              onNavigate?.();
              // Already on /data: land on the imports even when the address names them already.
              openAnchorOnClick(event, "/data#import");
            }}
            className={ITEM}
          >
            <Upload aria-hidden className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} />
            {t.data.menu.import}
          </Link>
        </li>
        <li>
          <Link href="/data" onClick={onNavigate} className={ITEM}>
            <Database aria-hidden className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} />
            {t.data.menu.manage}
          </Link>
        </li>
      </ul>
    </section>
  );
}
