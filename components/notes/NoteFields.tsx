"use client";

import { X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { parseNumberInput } from "@/components/alerts/form";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { isPlausibleReviewDate, MAX_TAGS, mergeTags, REVIEW_MAX_DATE, REVIEW_MIN_DATE, type Conviction } from "@/lib/notes";

import { levelLine, reviewText } from "./format";
import { useDraft } from "./useDraft";

const CONVICTIONS = ["1", "2", "3", "4", "5"] as const;

/** Conviction 1 to 5 as a radio group, with Clear once set. */
export function ConvictionField({ value, onChange }: { value: Conviction | null; onChange: (value: Conviction | null) => void }) {
  const { t } = usePrefs();
  return (
    <div className="space-y-1.5">
      <Segmented
        label={t.notes.conviction}
        value={value === null ? "" : String(value)}
        onChange={(next) => onChange(Number(next) as Conviction)}
        options={CONVICTIONS.map((n) => ({ value: n, label: n }))}
        className="[&_[role=radio]]:max-sm:h-10"
      />
      <div className="flex h-5 items-center justify-between text-xs text-fg-3">
        <span>{value === null ? "" : tpl(t.notes.convictionOf, { n: value })}</span>
        {value !== null ? (
          <button type="button" onClick={() => onChange(null)} className="rounded-xs px-1 text-fg-2 underline-offset-2 hover:text-fg hover:underline max-sm:min-h-10">
            {t.notes.clear}
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface LevelFieldProps {
  kind: "target" | "stop";
  value: number | null;
  price: number | null;
  onSave: (value: number | null) => void;
}

/** A target or "wrong below" price with its distance from the last price; saved after a pause in typing or on blur. */
export function LevelField({ kind, value, price, onSave }: LevelFieldProps) {
  const { t, lang } = usePrefs();
  const [touched, setTouched] = useState(false);
  const stored = value === null ? "" : String(value);
  const parsedOk = (text: string) => text.trim() === "" || (parseNumberInput(text) ?? 0) > 0;
  const { draft, setDraft, flush } = useDraft(stored, (text) => {
    if (!parsedOk(text)) return;
    onSave(text.trim() === "" ? null : parseNumberInput(text));
  });
  const invalid = touched && !parsedOk(draft);
  const level = parseNumberInput(draft);
  const crossed = level !== null && level > 0 && price !== null && (kind === "stop" ? price < level : price > level);
  const line = level !== null && level > 0 && !invalid ? levelLine(kind, level, price, t, lang) : null;
  const hint = line ? (
    <>
      {line}
      {crossed ? <span className={cn("block", kind === "stop" ? "text-warn" : "text-fg-2")}>{kind === "stop" ? t.notes.stopCrossed : t.notes.targetReached}</span> : null}
    </>
  ) : undefined;

  return (
    <Field label={kind === "target" ? t.notes.target : t.notes.stop} error={invalid ? t.notes.invalidLevel : undefined} hint={hint}>
      <Input
        inputMode="decimal"
        value={draft}
        placeholder={t.notes.levelPlaceholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setTouched(true);
          flush();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            setTouched(true);
            flush();
          }
        }}
        className="num max-sm:h-10"
      />
    </Field>
  );
}

/**
 * Review date with the days left or overdue. A date field reports every keystroke: typing a year passes through
 * "0002", "0020" and "0202", and a half-typed date reads as empty. So the field keeps a draft and stores only a whole,
 * plausible date, after a pause in typing, on blur or on Enter. Emptying the field removes the date; leaving it half
 * typed shows the stored date again.
 */
export function ReviewField({ value, days, onChange }: { value: string | null; days: number | null; onChange: (value: string | null) => void }) {
  const { t } = usePrefs();
  // True while the field holds a partly typed date, which the browser reports as an empty value.
  const incomplete = useRef(false);
  const { draft, setDraft, flush, reset } = useDraft(value ?? "", (text) => {
    if (isPlausibleReviewDate(text) && text !== value) onChange(text);
  });
  const finish = () => {
    if (draft === "" && !incomplete.current) {
      // Emptied on purpose: remove the date (the draft hook ignores the empty value itself).
      flush();
      if (value !== null) onChange(null);
    } else if (isPlausibleReviewDate(draft)) {
      flush();
    } else {
      reset();
    }
  };
  const status = days === null ? null : reviewText(days, t);
  return (
    <Field label={t.notes.reviewBy} hint={status ? <span className={days !== null && days < 0 ? "text-warn" : undefined}>{status}</span> : undefined}>
      <Input
        type="date"
        value={draft}
        min={REVIEW_MIN_DATE}
        max={REVIEW_MAX_DATE}
        onChange={(event) => {
          incomplete.current = event.currentTarget.validity.badInput;
          setDraft(event.currentTarget.value);
        }}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish();
        }}
        className="num max-sm:h-10"
      />
    </Field>
  );
}

/** Tags as removable chips plus an input: Enter or a comma adds, Backspace in the empty input removes the last one. */
export function TagsField({ tags, onChange }: { tags: readonly string[]; onChange: (tags: string[]) => void }) {
  const { t } = usePrefs();
  const inputId = useId();
  const [text, setText] = useState("");
  const full = tags.length >= MAX_TAGS;

  const add = () => {
    const next = mergeTags(tags, text);
    if (next.length !== tags.length) onChange(next);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !text && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="space-y-1.5">
      {full ? (
        <div className="text-xs font-medium text-fg-2">{t.notes.tags}</div>
      ) : (
        <label htmlFor={inputId} className="block text-xs font-medium text-fg-2">
          {t.notes.tags}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex h-7 items-center gap-0.5 rounded-xs border border-line-2 pl-2 text-xs text-fg-2 max-sm:h-10">
            {tag}
            <button
              type="button"
              aria-label={tpl(t.notes.removeTag, { tag })}
              title={tpl(t.notes.removeTag, { tag })}
              onClick={() => onChange(tags.filter((item) => item !== tag))}
              className="inline-flex size-6 items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-hover hover:text-fg max-sm:size-10"
            >
              <X aria-hidden className="size-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        {full ? (
          <span className="text-xs text-fg-3">{tpl(t.notes.tagsFull, { n: MAX_TAGS })}</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Input
              id={inputId}
              size="sm"
              value={text}
              maxLength={40}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => {
                if (text.trim()) add();
              }}
              placeholder={t.notes.tagPlaceholder}
              className="w-32 max-sm:h-10"
            />
            {text.trim() ? (
              <Button size="sm" onClick={add} className="max-sm:h-10">
                {t.notes.addTag}
              </Button>
            ) : null}
          </span>
        )}
      </div>
    </div>
  );
}
