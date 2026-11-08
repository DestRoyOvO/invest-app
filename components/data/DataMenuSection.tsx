"use client";

import { Database, Download, Upload } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { useToast } from "@/components/ui/Toast";
import { useLocalStore } from "@/hooks/useLocalStore";
import { backupAgeDays, backupMetaStore } from "@/lib/backup";
import { tpl } from "@/lib/format";

import { exportBackupNow } from "./browser";
import { lastBackupLabel } from "./labels";

const ITEM =
  "flex h-7 w-full items-center gap-2 rounded-xs px-1.5 text-left text-xs text-fg transition-colors hover:bg-hover focus-visible:outline-offset-[-2px] max-sm:h-10";

/** "Your data" in the settings menu: export a backup at once, or go to the import and data management page. */
export function DataMenuSection({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const toast = useToast();
  const headingId = useId();
  const meta = useLocalStore(backupMetaStore);

  const onExport = () => {
    const file = exportBackupNow();
    toast.show({ message: tpl(t.data.backup.exported, { file }) });
    onNavigate?.();
  };

  return (
    <section aria-labelledby={headingId} className="border-t border-line pt-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-xs font-medium text-fg-2">
          {t.data.menu.title}
        </h3>
        <span className="truncate text-micro text-fg-3">{lastBackupLabel(t, backupAgeDays(meta.lastBackupAt))}</span>
      </div>
      <ul className="-mx-1.5">
        <li>
          <button type="button" onClick={onExport} className={ITEM}>
            <Download aria-hidden className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} />
            {t.data.menu.export}
          </button>
        </li>
        <li>
          <Link href="/data#import" onClick={onNavigate} className={ITEM}>
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
