"use client";

import { AlertCircle, Check, Trash2 } from "lucide-react";
import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { clearAllData, StorageWriteError, undoChanges, type StorageChange } from "@/lib/backup";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";

import { exportBackupNow, getEnv } from "./browser";
import { TOUCH } from "./styles";

/** The confirmation word works in either language, whichever the page shows. */
const CONFIRM_WORDS = ["CLEAR", "清除"];

/** Removes everything the app stored in this browser after the user types the confirmation word; Undo puts it back. */
export function ClearDataPanel() {
  const { t } = usePrefs();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [cleared, setCleared] = useState<StorageChange[] | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const confirmed = CONFIRM_WORDS.includes(typed.trim().toUpperCase());

  const undo = (changes: readonly StorageChange[]) => {
    const env = getEnv();
    if (env) undoChanges(env, changes);
    setCleared(null);
    toast.show({ message: t.data.clear.undone });
  };

  const onClear = () => {
    setMessage(null);
    const env = getEnv();
    if (!env) {
      setMessage({ text: t.data.backup.errors.unavailable, error: true });
      return;
    }
    try {
      const changes = clearAllData(env);
      setTyped("");
      if (changes.length === 0) {
        setMessage({ text: t.data.clear.nothing, error: false });
        return;
      }
      setCleared(changes);
      toast.show({ message: t.data.clear.done, action: { label: t.data.undo, onAction: () => undo(changes) } });
    } catch (cause) {
      setMessage({ text: cause instanceof StorageWriteError ? t.data.backup.errors[cause.reason] : t.data.backup.errors.unavailable, error: true });
    }
  };

  return (
    <Panel title={t.data.clear.title}>
      <div className="space-y-3 px-3 py-3">
        <p className="text-sm text-fg-2">{t.data.clear.body}</p>
        <Button size="sm" variant="ghost" onClick={() => toast.show({ message: tpl(t.data.backup.exported, { file: exportBackupNow() }) })} className={cn("-ml-2", TOUCH)}>
          {t.data.clear.backupFirst}
        </Button>
        <Field label={tpl(t.data.clear.label, { word: t.data.clear.word })}>
          <Input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} className="max-w-48" />
        </Field>
        <Button onClick={onClear} disabled={!confirmed} className={TOUCH}>
          <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
          {t.data.clear.button}
        </Button>
        {cleared ? (
          // The clear button is disabled once the word is reset, so focus moves to the result.
          <div role="status" tabIndex={-1} autoFocus className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-fg-2 focus:outline-none">
            <Check aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={2} />
            <span>{t.data.clear.done}</span>
            <Button size="sm" variant="ghost" onClick={() => undo(cleared)} className={TOUCH}>
              {t.data.undo}
            </Button>
          </div>
        ) : null}
        {message?.error ? (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
            {message.text}
          </p>
        ) : message ? (
          <p role="status" className="text-sm text-fg-2">
            {message.text}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
