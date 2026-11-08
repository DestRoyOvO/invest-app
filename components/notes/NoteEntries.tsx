"use client";

import { Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Markdown } from "@/components/ai/Markdown";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { AiChip } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatDate, formatPrice, formatTime, tpl } from "@/lib/format";
import { addNoteEntry, MAX_ENTRY_CHARS, removeNoteEntry, restoreNoteEntry, type NoteEntry } from "@/lib/notes";

const LONG_CHARS = 280;
const LONG_LINES = 4;

function EntryItem({ entry, onRemove }: { entry: NoteEntry; onRemove: () => void }) {
  const { t, lang } = usePrefs();
  const [expanded, setExpanded] = useState(false);
  const long = entry.text.length > LONG_CHARS || entry.text.split("\n").length > LONG_LINES;
  const date = formatDate(entry.at, lang);
  return (
    <li className="relative pb-3 pl-4 last:pb-0">
      <span aria-hidden className="absolute top-[0.4rem] -left-[3.5px] size-1.5 rounded-full bg-fg-3" />
      <div className="flex min-h-7 items-center gap-2 text-xs text-fg-3">
        <time dateTime={entry.at} className="num" title={`${date} ${formatTime(entry.at, lang)}`}>
          {date}
        </time>
        {entry.price !== null ? <span className="num">{tpl(t.notes.entryPrice, { price: formatPrice(entry.price, lang) })}</span> : null}
        {entry.kind === "ai" ? (
          <>
            <AiChip />
            <span className="sr-only">{t.notes.aiEntry}</span>
          </>
        ) : null}
        <IconButton size="sm" className="ml-auto" label={tpl(t.notes.removeEntry, { date })} icon={<Trash2 className="size-3.5" strokeWidth={1.75} />} onClick={onRemove} />
      </div>
      <div className={cn("mt-0.5", long && !expanded && "max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]")}>
        {entry.kind === "ai" ? <Markdown text={entry.text} /> : <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-2">{entry.text}</p>}
      </div>
      {long ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 rounded-xs text-xs text-fg-2 underline-offset-2 hover:text-fg hover:underline max-sm:min-h-10"
        >
          {expanded ? t.common.less : t.common.more}
        </button>
      ) : null}
    </li>
  );
}

/** Dated entries, newest first: the investor's observations and AI notes they kept, each with the price at the time. */
export function NoteEntries({ symbol, entries, price }: { symbol: string; entries: readonly NoteEntry[]; price: number | null }) {
  const { t } = usePrefs();
  const toast = useToast();
  const headingId = useId();
  const inputId = useId();
  const [text, setText] = useState("");

  const add = () => {
    if (!text.trim()) return;
    addNoteEntry(symbol, { text, price });
    setText("");
  };

  const remove = (entry: NoteEntry) => {
    removeNoteEntry(symbol, entry.at);
    toast.show({ message: t.notes.entryRemoved, action: { label: t.notes.undo, onAction: () => restoreNoteEntry(symbol, entry) } });
  };

  return (
    <section aria-labelledby={headingId} className="space-y-2.5">
      <h3 id={headingId} className="col-head flex items-center gap-1.5">
        {t.notes.entries}
        {entries.length > 0 ? <span className="num text-fg-3">{entries.length}</span> : null}
      </h3>
      <div className="flex flex-col gap-2 @md:flex-row @md:items-start">
        <label htmlFor={inputId} className="sr-only">
          {t.notes.addEntry}
        </label>
        <Textarea
          id={inputId}
          rows={2}
          value={text}
          maxLength={MAX_ENTRY_CHARS}
          placeholder={t.notes.entryPlaceholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="min-h-16 flex-1"
        />
        <Button onClick={add} disabled={!text.trim()} className="self-start">
          {t.notes.addEntry}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-fg-3">{t.notes.noEntries}</p>
      ) : (
        <ol className="ml-1 border-l border-line-2">
          {entries.map((entry) => (
            <EntryItem key={entry.at} entry={entry} onRemove={() => remove(entry)} />
          ))}
        </ol>
      )}
    </section>
  );
}
