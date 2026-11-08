"use client";

import { ChevronRight, DatabaseBackup } from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";

import { lastBackupLabel } from "@/components/data/labels";
import { useT } from "@/components/providers/PrefsProvider";

import { useBackupReminder } from "./backup-reminder";
import { openAnchorOnClick } from "./HashLanding";

/** The backup panel on /data (export and restore), where the reminder leads. */
export const BACKUP_PANEL_HREF = "/data#restore";

/**
 * On /data already, a plain click opens the panel in place, because the router scrolls only when the hash changes;
 * from another page the link navigates and HashLanding lands on the panel once /data has rendered.
 */
function openPanel(event: MouseEvent<HTMLAnchorElement>) {
  openAnchorOnClick(event, BACKUP_PANEL_HREF);
}

/**
 * Desktop: the status bar's backup state while a backup is due (useBackupReminder), in the caveat color and linking to
 * the backup panel. It never interrupts (no toast, no dialog) and goes away with the next export.
 */
export function BackupStatus() {
  const t = useT();
  const reminder = useBackupReminder();
  if (!reminder) return null;
  return (
    <Link
      href={BACKUP_PANEL_HREF}
      onClick={openPanel}
      title={t.data.backup.title}
      className="-mx-1.5 flex h-6 items-center gap-1.5 rounded-xs px-1.5 text-warn transition-colors hover:bg-hover"
    >
      <DatabaseBackup aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      {lastBackupLabel(t, reminder.days, { short: true })}
    </Link>
  );
}

/**
 * Phones, which have no status bar: the same state in the More sheet, as a row under DATA that opens the backup
 * panel. A list item of the sheet's Tools grid, spanning both columns.
 */
export function BackupReminderItem({ onNavigate }: { onNavigate: () => void }) {
  const t = useT();
  const reminder = useBackupReminder();
  if (!reminder) return null;
  return (
    <li className="col-span-2 bg-panel">
      <Link
        href={BACKUP_PANEL_HREF}
        onClick={(event) => {
          onNavigate();
          openPanel(event);
        }}
        className="flex h-11 items-center gap-2 px-2.5 text-sm transition-colors hover:bg-hover"
      >
        <DatabaseBackup aria-hidden className="size-4 shrink-0 text-warn" strokeWidth={1.75} />
        <span className="min-w-0 truncate text-warn">{lastBackupLabel(t, reminder.days)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs text-fg-3">
          {t.data.backup.title}
          <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.75} />
        </span>
      </Link>
    </li>
  );
}
