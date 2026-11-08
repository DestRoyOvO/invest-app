"use client";

import { AlertCircle, Check, Download, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { useLocalStore } from "@/hooks/useLocalStore";
import {
  applyBackup,
  backupAgeDays,
  backupMetaStore,
  diffRestore,
  formatBytes,
  hasChanges,
  MAX_BACKUP_BYTES,
  parseBackup,
  prefChanges,
  StorageWriteError,
  undoChanges,
  type Backup,
  type PrefCookies,
  type RestoreMode,
  type RestoreResult,
  type StoreDiff,
} from "@/lib/backup";
import { MAX_WATCHLIST } from "@/lib/universe";
import { formatDate, formatTime, tpl } from "@/lib/format";

import { exportBackupNow, getEnv } from "./browser";
import { usePrefsSync, useStorageSnapshot } from "./hooks";
import { diffSummary, lastBackupLabel, prefNameLabel, prefValueLabel, storeLabel, symbolList } from "./labels";
import { ResultLine } from "./ResultLine";
import { focusSoon, TOUCH } from "./styles";

type RestoreState =
  | { phase: "idle" }
  | { phase: "reading"; file: string }
  | { phase: "error"; message: string }
  | { phase: "preview"; file: string; size: number; backup: Backup; confirming: boolean }
  | { phase: "done"; file: string; result: RestoreResult; prefsBefore: PrefCookies | null };

const KNOWN_KINDS = new Set<StoreDiff["kind"]>(["watchlist", "holdings", "notes"]);
/** Written by hooks/useLastSymbol.ts whenever a quote page opens; not data the user would miss. */
const LAST_SYMBOL_KEY = "investseek:last-symbol";

/** Export a backup file; restore one with a preview of what changes, Merge or Replace, a confirmation and Undo. */
export function BackupPanel() {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const meta = useLocalStore(backupMetaStore);
  const snapshot = useStorageSnapshot();
  const prefsSync = usePrefsSync();
  const [state, setState] = useState<RestoreState>({ phase: "idle" });
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [restorePrefs, setRestorePrefs] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  // Reading and checking a file is asynchronous; only the latest pick may update the panel.
  const pickCount = useRef(0);
  const lastBackup = lastBackupLabel(t, backupAgeDays(meta.lastBackupAt));

  const onExport = () => {
    const file = exportBackupNow();
    toast.show({ message: tpl(t.data.backup.exported, { file }) });
  };

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    const pick = ++pickCount.current;
    if (picked.size > MAX_BACKUP_BYTES) {
      setState({ phase: "error", message: t.data.backup.errors.too_large });
      return;
    }
    setState({ phase: "reading", file: picked.name });
    let text: string;
    try {
      text = await picked.text();
    } catch {
      if (pick === pickCount.current) setState({ phase: "error", message: t.data.backup.errors.read });
      return;
    }
    const current = snapshot ?? {};
    const parsed = await parseBackup(text, current);
    if (pick !== pickCount.current) return;
    if (!parsed.ok) {
      setState({ phase: "error", message: t.data.backup.errors[parsed.error] });
      return;
    }
    // With nothing of the user's stored here (the last viewed symbol does not count) there is nothing to lose, so
    // moving in replaces the starter watchlist instead of adding to it.
    setMode(Object.keys(current).every((key) => key === LAST_SYMBOL_KEY) ? "replace" : "merge");
    setRestorePrefs(true);
    setState({ phase: "preview", file: picked.name, size: picked.size, backup: parsed.value.backup, confirming: false });
  };

  // The preview follows what is stored now, so an edit in another tab shows up before anything is written.
  const diffs = useMemo(() => (state.phase === "preview" && snapshot ? diffRestore(snapshot, state.backup, mode) : []), [state, snapshot, mode]);
  // Compared with what the page shows, which may come from defaults rather than cookies.
  const prefs = state.phase === "preview" ? prefChanges(state.backup, prefsSync.current()) : [];
  const visible = diffs.filter((diff) => hasChanges(diff) || diff.rejected);
  const nothingToDo = visible.every((diff) => diff.rejected) && (prefs.length === 0 || !restorePrefs);

  const undo = (result: RestoreResult, prefsBefore: PrefCookies | null) => {
    const env = getEnv();
    if (env) undoChanges(env, result.changes);
    if (prefsBefore) prefsSync.apply(prefsBefore);
    // The toast's Undo can come after another file was picked; only this restore's result line goes away.
    setState((current) => (current.phase === "done" && current.result === result ? { phase: "idle" } : current));
    toast.show({ message: t.data.backup.undone });
  };

  const restore = () => {
    if (state.phase !== "preview") return;
    const env = getEnv();
    if (!env) {
      setState({ phase: "error", message: t.data.backup.errors.unavailable });
      focusSoon(pickRef);
      return;
    }
    const prefsBefore = restorePrefs && prefs.length > 0 ? prefsSync.current() : null;
    try {
      const result = applyBackup(state.backup, mode, env, { prefs: restorePrefs });
      if (result.cookies.length > 0) prefsSync.apply(Object.fromEntries(result.cookies.map((change) => [change.name, change.newValue])));
      setState({ phase: "done", file: state.file, result, prefsBefore });
      toast.show({ message: tpl(t.data.backup.restored, { summary: diffSummary(t, result.diffs) }), action: { label: t.data.undo, onAction: () => undo(result, prefsBefore) } });
    } catch (cause) {
      setState({ phase: "error", message: cause instanceof StorageWriteError ? t.data.backup.errors[cause.reason] : t.data.backup.errors.invalid });
      // The confirm button is gone; the error is announced and the file button is the way on.
      focusSoon(pickRef);
    }
  };

  const columns: DataTableColumn<StoreDiff>[] = [
    {
      key: "data",
      header: t.data.backup.columns.data,
      render: (diff) => {
        const label = storeLabel(t, diff.key);
        return label ? (
          <span className="text-fg" title={diff.key}>
            {label}
          </span>
        ) : (
          <span className="mono text-fg-2">{diff.key}</span>
        );
      },
    },
    { key: "added", header: t.data.backup.columns.added, align: "right", width: "5rem", render: (diff) => <Count n={diff.added.length} /> },
    { key: "changed", header: t.data.backup.columns.changed, align: "right", width: "5.5rem", render: (diff) => <Count n={diff.changed.length} /> },
    { key: "removed", header: t.data.backup.columns.removed, align: "right", width: "5.5rem", render: (diff) => <Count n={diff.removed.length} /> },
    {
      key: "details",
      header: t.data.backup.columns.details,
      hideBelow: "md",
      render: (diff) => {
        if (diff.rejected) return <span className="text-warn">{t.data.backup.rejected}</span>;
        if (!KNOWN_KINDS.has(diff.kind)) return null;
        const parts = [...diff.added.map((s) => `+${s}`), ...diff.changed.map((s) => `~${s}`), ...diff.removed.map((s) => `−${s}`)];
        return (
          <span className="mono text-fg-2" title={parts.join(" ")}>
            {parts.slice(0, 12).join(" ")}
            {parts.length > 12 ? ` +${parts.length - 12}` : ""}
          </span>
        );
      },
    },
  ];

  const notes =
    state.phase === "preview"
      ? [
          ...visible.filter((diff) => diff.invalid > 0).map((diff) => tpl(t.data.backup.invalidEntries, { store: storeLabel(t, diff.key) ?? diff.key, n: diff.invalid })),
          ...visible.filter((diff) => diff.overflow.length > 0).map((diff) => tpl(t.data.backup.overflow, { max: MAX_WATCHLIST, symbols: symbolList(diff.overflow) })),
          ...diffs.filter((diff) => diff.keptLocal.length > 0).map((diff) => tpl(t.data.backup.keptLocal, { symbols: symbolList(diff.keptLocal) })),
        ]
      : [];

  return (
    <Panel id="restore" code="DATA" title={t.data.backup.title} actions={<PanelMeta>{lastBackup}</PanelMeta>}>
      <div className="space-y-3 px-3 py-3">
        <p className="text-sm text-fg-2">{t.data.privacy}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={onExport} className={TOUCH}>
            <Download aria-hidden className="size-4" strokeWidth={1.75} />
            {t.data.backup.export}
          </Button>
          <Button ref={pickRef} onClick={() => inputRef.current?.click()} className={TOUCH}>
            <Upload aria-hidden className="size-4" strokeWidth={1.75} />
            {t.data.backup.restore}
          </Button>
          <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={onPick} />
        </div>
        <p className="text-xs text-fg-3">{t.data.backup.exportHint}</p>
      </div>

      {state.phase === "reading" ? (
        <p role="status" className="border-t border-line px-3 py-2.5 text-sm text-fg-2">
          {tpl(t.data.backup.reading, { file: state.file })}
        </p>
      ) : null}

      {state.phase === "error" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3 py-2.5">
          <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            {state.message}
          </p>
          <Button size="sm" onClick={() => inputRef.current?.click()} className={TOUCH}>
            {t.data.backup.another}
          </Button>
        </div>
      ) : null}

      {state.phase === "done" ? (
        // Focus moves here from the confirm button that just disappeared, so keyboard users keep their place.
        <ResultLine className="gap-y-2 border-t border-line px-3 py-2.5">
          <Check aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={2} />
          <span className="min-w-0">{tpl(t.data.backup.done, { file: state.file, summary: diffSummary(t, state.result.diffs) })}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              undo(state.result, state.prefsBefore);
              focusSoon(pickRef);
            }}
            className={TOUCH}
          >
            {t.data.undo}
          </Button>
        </ResultLine>
      ) : null}

      {state.phase === "preview" ? (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 pt-3">
            <span className="mono text-sm break-all text-fg">{state.file}</span>
            <span className="num text-xs text-fg-3">
              {tpl(t.data.backup.fileMeta, { date: `${formatDate(state.backup.exportedAt, lang)} ${formatTime(state.backup.exportedAt, lang)}`, size: formatBytes(state.size) })}
            </span>
          </div>
          <div className="space-y-1.5 px-3 py-3">
            <Segmented
              size="sm"
              label={t.data.backup.mode}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setState({ ...state, confirming: false });
              }}
              options={[
                { value: "merge", label: t.data.backup.merge },
                { value: "replace", label: t.data.backup.replace },
              ]}
              className="max-w-56"
            />
            <p className="max-w-prose text-xs text-fg-3">{mode === "merge" ? t.data.backup.mergeHint : t.data.backup.replaceHint}</p>
          </div>
          {visible.length > 0 ? (
            <DataTable rows={visible} columns={columns} rowKey={(diff) => diff.key} caption={t.data.backup.caption} rowClassName={() => "hover:bg-panel!"} />
          ) : null}
          <div className="space-y-3 px-3 py-3">
            {notes.map((note, index) => (
              <p key={index} className="text-xs text-fg-2">
                {note}
              </p>
            ))}
            {prefs.length > 0 ? (
              <Checkbox
                label={t.data.backup.prefs}
                description={prefs.map((change) => tpl(t.data.prefs.change, { name: prefNameLabel(t, change.name), from: prefValueLabel(t, change.from), to: prefValueLabel(t, change.to) })).join(" · ")}
                checked={restorePrefs}
                onChange={(event) => setRestorePrefs(event.target.checked)}
              />
            ) : null}
            {nothingToDo ? (
              <p className="text-sm text-fg-2">{t.data.backup.nothingToDo}</p>
            ) : state.confirming ? (
              // Keyed apart from the row it replaces, so React mounts a new "Restore now" (and runs its autoFocus)
              // instead of reusing the Cancel button's element.
              <div key="confirm" className="flex flex-wrap items-center gap-2">
                <p className="w-full text-sm text-fg">{tpl(mode === "merge" ? t.data.backup.confirmMerge : t.data.backup.confirmReplace, { summary: diffSummary(t, visible) })}</p>
                <Button onClick={restore} className={TOUCH} autoFocus>
                  {t.data.backup.confirm}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setState({ ...state, confirming: false });
                    focusSoon(startRef);
                  }}
                  className={TOUCH}
                >
                  {t.data.cancel}
                </Button>
              </div>
            ) : (
              <div key="start" className="flex flex-wrap items-center gap-2">
                <Button ref={startRef} onClick={() => setState({ ...state, confirming: true })} className={TOUCH}>
                  {t.data.backup.start}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setState({ phase: "idle" });
                    focusSoon(pickRef);
                  }}
                  className={TOUCH}
                >
                  {t.data.cancel}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function Count({ n }: { n: number }) {
  return <span className={n > 0 ? "num text-fg" : "num text-fg-3"}>{n}</span>;
}
