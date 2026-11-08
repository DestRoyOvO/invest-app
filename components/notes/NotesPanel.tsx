"use client";

import { BellPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { requestNotificationPermission } from "@/hooks/useAlerts";
import { useHydrated } from "@/hooks/useLocalValue";
import { useNote, useNow } from "@/hooks/useNotes";
import { addAlertRule, alertsStore, removeAlertRule, type AlertKind } from "@/lib/alerts";
import { cn } from "@/lib/cn";
import { formatInteger, formatPrice, tpl } from "@/lib/format";
import { MAX_THESIS_CHARS, removeNote, restoreNote, reviewDaysLeft, updateNote, type SymbolNote } from "@/lib/notes";

import { NoteEntries } from "./NoteEntries";
import { ConvictionField, LevelField, ReviewField, TagsField } from "./NoteFields";
import { useDraft } from "./useDraft";

interface NoteEditorProps {
  symbol: string;
  price: number | null;
  note: SymbolNote | undefined;
  focusThesis: boolean;
  onDeleted: () => void;
}

function NoteEditor({ symbol, price, note, focusThesis, onDeleted }: NoteEditorProps) {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const now = useNow();
  const thesisId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = (patch: Parameters<typeof updateNote>[1]) => {
    updateNote(symbol, patch);
    setSavedAt(Date.now());
  };
  const thesis = useDraft(note?.thesis ?? "", (value) => save({ thesis: value }));

  useEffect(() => {
    if (focusThesis) textareaRef.current?.focus();
  }, [focusThesis]);

  const createLevelAlert = (kind: AlertKind, level: number) => {
    const rules = alertsStore.getSnapshot();
    const exists = rules.some((rule) => rule.symbol === symbol && rule.kind === kind && rule.value === level && !rule.paused && !rule.done);
    const result = exists ? null : addAlertRule({ symbol, kind, value: level, repeat: "once", note: kind === "below" ? t.notes.stop : t.notes.target });
    if (result && result.status !== "added") return;
    // Ask once, from this click, when the first rule exists; never on page load.
    if (result && rules.length === 0) void requestNotificationPermission();
    const side = kind === "below" ? t.notes.alertSideBelow : t.notes.alertSideAbove;
    toast.show({
      message: tpl(t.notes.alertCreated, { symbol, side, level: formatPrice(level, lang) }),
      action: result ? { label: t.notes.undo, onAction: () => removeAlertRule(result.rule.id) } : undefined,
    });
  };

  const deleteNote = () => {
    if (!note) return;
    removeNote(symbol);
    onDeleted();
    toast.show({ message: tpl(t.notes.noteDeleted, { symbol }), action: { label: t.notes.undo, onAction: () => restoreNote(symbol, note) } });
  };

  const length = thesis.draft.length;
  const status = thesis.dirty ? t.notes.saving : savedAt ? t.notes.saved : "";
  // Quick alerts only for a level still ahead of the price (an alert for a level already passed would fire at once).
  const stopAlert = note?.stop && (price === null || price > note.stop) ? note.stop : null;
  const targetAlert = note?.target && (price === null || price < note.target) ? note.target : null;

  return (
    <div className="@container">
      <div className="space-y-4 px-3 py-3">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={thesisId} className="text-xs font-medium text-fg-2">
              {t.notes.thesis}
            </label>
            <span className="flex items-baseline gap-2 text-xs text-fg-3">
              <span aria-live="polite">{status}</span>
              <span className={cn("num", length > MAX_THESIS_CHARS * 0.9 && "text-warn")}>
                {tpl(t.notes.chars, { n: formatInteger(length, lang), max: formatInteger(MAX_THESIS_CHARS, lang) })}
              </span>
            </span>
          </div>
          <Textarea
            ref={textareaRef}
            id={thesisId}
            rows={4}
            value={thesis.draft}
            maxLength={MAX_THESIS_CHARS}
            placeholder={t.notes.thesisPlaceholder}
            onChange={(event) => thesis.setDraft(event.target.value)}
            onBlur={thesis.flush}
          />
        </div>

        <div className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-4">
          <ConvictionField value={note?.conviction ?? null} onChange={(conviction) => save({ conviction })} />
          <ReviewField value={note?.reviewBy ?? null} days={now ? reviewDaysLeft(note?.reviewBy, now) : null} onChange={(reviewBy) => save({ reviewBy })} />
          <LevelField kind="target" value={note?.target ?? null} price={price} onSave={(target) => save({ target })} />
          <LevelField kind="stop" value={note?.stop ?? null} price={price} onSave={(stop) => save({ stop })} />
        </div>

        <TagsField tags={note?.tags ?? []} onChange={(tags) => save({ tags })} />

        {stopAlert || targetAlert ? (
          <div className="flex flex-wrap gap-2">
            {stopAlert ? (
              <Button size="sm" className="max-sm:h-10" onClick={() => createLevelAlert("below", stopAlert)}>
                <BellPlus aria-hidden className="size-3.5" strokeWidth={1.75} />
                {t.notes.alertAtStop}
              </Button>
            ) : null}
            {targetAlert ? (
              <Button size="sm" className="max-sm:h-10" onClick={() => createLevelAlert("above", targetAlert)}>
                <BellPlus aria-hidden className="size-3.5" strokeWidth={1.75} />
                {t.notes.alertAtTarget}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-line pt-3">
          <NoteEntries symbol={symbol} entries={note?.entries ?? []} price={price} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-fg-3">
          <span>{t.notes.storedLocally}</span>
          {note ? (
            <Button size="sm" variant="ghost" className="max-sm:h-10" onClick={deleteNote}>
              {t.notes.deleteNote}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The investor's thesis, levels, review date, tags and dated entries for one symbol (NOTE). Compact until there is
 * something to show; changes are saved in this browser while typing.
 */
export function NotesPanel({ symbol, price, className }: { symbol: string; price: number | null; className?: string }) {
  const { t } = usePrefs();
  const hydrated = useHydrated();
  const note = useNote(symbol);
  // Once the editor is open for a symbol it stays open, so emptying every field mid-edit does not swap it away.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (note && openFor !== symbol) setOpenFor(symbol);
  const editing = openFor === symbol;

  return (
    <Panel
      id="notes"
      title={t.notes.title}
      code="NOTE"
      className={className}
      actions={
        <Link href="/notes" className="rounded-xs px-1.5 py-1 text-xs text-fg-2 transition-colors hover:bg-hover hover:text-fg max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
          {t.notes.allNotes}
        </Link>
      }
    >
      {!hydrated ? (
        <SkeletonRows rows={2} />
      ) : note || editing ? (
        <NoteEditor key={symbol} symbol={symbol} price={price} note={note} focusThesis={editing && !note} onDeleted={() => setOpenFor(null)} />
      ) : (
        <EmptyState
          actions={
            <Button size="sm" className="max-sm:h-10" onClick={() => setOpenFor(symbol)}>
              {t.notes.write}
            </Button>
          }
        >
          {tpl(t.notes.emptyPrompt, { symbol })}
        </EmptyState>
      )}
    </Panel>
  );
}
