// The investor's thesis notes, one per symbol, stored only in this browser (lib/local-store.ts).
//
// A note records why the investor holds or watches a stock and what would change their mind: a thesis, a conviction
// level, a target and a "wrong below" stop level chosen in advance, a review date, tags, and dated entries (their own
// observations or AI notes they chose to keep, each with the price at the time). The quote page, the chart (price
// lines), the notes list and the backup all read this one store.

import { createLocalStore } from "./local-store";
import { normalizeSymbol } from "./symbols";

export interface NoteEntry {
  /** ISO time the entry was written. */
  at: string;
  /** Price of the symbol when the entry was written, if known. */
  price: number | null;
  text: string;
  /** "ai" for a research note the investor saved from the assistant. */
  kind: "note" | "ai";
}

export type Conviction = 1 | 2 | 3 | 4 | 5;

export interface SymbolNote {
  thesis: string;
  conviction: Conviction | null;
  /** Price the investor expects or aims for. */
  target: number | null;
  /** "I am wrong below" level. */
  stop: number | null;
  /** ISO date (YYYY-MM-DD) by which to review the thesis. */
  reviewBy: string | null;
  tags: string[];
  /** Newest first. */
  entries: NoteEntry[];
  updatedAt: string;
}

export type NotesBook = Readonly<Record<string, SymbolNote>>;

export const NOTES_STORAGE_KEY = "investseek:notes:v1";
export const MAX_THESIS_CHARS = 2000;
export const MAX_ENTRY_CHARS = 4000;
export const MAX_ENTRIES = 100;
export const MAX_TAGS = 8;
export const MAX_TAG_CHARS = 24;

const EMPTY: NotesBook = {};
const DAY_MS = 86_400_000;

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * A tag as stored: trimmed, inner whitespace collapsed, lower case (so "AI" and "ai" are one tag) and at most
 * MAX_TAG_CHARS long. Commas separate tags in the editor, so they are removed. Empty input gives "".
 */
export function normalizeTag(value: string): string {
  return value.replace(/[,，]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_TAG_CHARS).trim();
}

function sanitizeEntry(raw: unknown): NoteEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const { at, price, text: body, kind } = raw as Record<string, unknown>;
  const clean = text(body, MAX_ENTRY_CHARS).trim();
  if (!clean || !isIsoTime(at)) return null;
  return { at, price: isPositive(price) ? price : null, text: clean, kind: kind === "ai" ? "ai" : "note" };
}

function sanitizeNote(raw: unknown): SymbolNote | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const conviction = typeof r.conviction === "number" && [1, 2, 3, 4, 5].includes(r.conviction) ? (r.conviction as Conviction) : null;
  const tags = Array.isArray(r.tags) ? [...new Set(r.tags.filter((t): t is string => typeof t === "string").map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS) : [];
  const entries = Array.isArray(r.entries)
    ? r.entries
        .map(sanitizeEntry)
        .filter((e): e is NoteEntry => e !== null)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, MAX_ENTRIES)
    : [];
  return {
    thesis: text(r.thesis, MAX_THESIS_CHARS),
    conviction,
    target: isPositive(r.target) ? r.target : null,
    stop: isPositive(r.stop) ? r.stop : null,
    reviewBy: isIsoDate(r.reviewBy) ? r.reviewBy : null,
    tags,
    entries,
    updatedAt: isIsoTime(r.updatedAt) ? r.updatedAt : new Date(0).toISOString(),
  };
}

/** True when a note carries nothing worth keeping (it is then removed instead of stored). */
export function isEmptyNote(note: SymbolNote): boolean {
  return !note.thesis.trim() && note.conviction === null && note.target === null && note.stop === null && note.reviewBy === null && note.tags.length === 0 && note.entries.length === 0;
}

/** Turns stored or imported data into a valid notes book; invalid symbols and fields are dropped. */
export function sanitizeNotes(raw: unknown): NotesBook {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY;
  const out: Record<string, SymbolNote> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const symbol = normalizeSymbol(key);
    const note = symbol ? sanitizeNote(value) : null;
    if (symbol && note && !isEmptyNote(note)) out[symbol] = note;
  }
  return out;
}

export const notesStore = createLocalStore<NotesBook>({ key: NOTES_STORAGE_KEY, sanitize: sanitizeNotes, empty: EMPTY });

export function emptyNote(now = new Date()): SymbolNote {
  return { thesis: "", conviction: null, target: null, stop: null, reviewBy: null, tags: [], entries: [], updatedAt: now.toISOString() };
}

/** Changes the fields of a symbol's note (creating it if needed); a note left empty is removed. */
export function updateNote(symbol: string, patch: Partial<Omit<SymbolNote, "entries" | "updatedAt">>, now = new Date()): void {
  notesStore.update((book) => {
    const current = book[symbol] ?? emptyNote(now);
    const next = sanitizeNote({ ...current, ...patch, updatedAt: now.toISOString() });
    const copy = { ...book };
    if (!next || isEmptyNote(next)) delete copy[symbol];
    else copy[symbol] = next;
    return copy;
  });
}

/** Adds a dated entry (newest first, capped at MAX_ENTRIES). Empty text is ignored. */
export function addNoteEntry(symbol: string, entry: { text: string; price: number | null; kind?: NoteEntry["kind"] }, now = new Date()): void {
  const clean = entry.text.trim().slice(0, MAX_ENTRY_CHARS);
  if (!clean) return;
  notesStore.update((book) => {
    const current = book[symbol] ?? emptyNote(now);
    const added: NoteEntry = { at: now.toISOString(), price: isPositive(entry.price) ? entry.price : null, text: clean, kind: entry.kind ?? "note" };
    return { ...book, [symbol]: { ...current, entries: [added, ...current.entries].slice(0, MAX_ENTRIES), updatedAt: now.toISOString() } };
  });
}

/** Puts back an entry removed a moment ago (the Undo of removeNoteEntry), keeping the newest-first order. */
export function restoreNoteEntry(symbol: string, entry: NoteEntry, now = new Date()): void {
  notesStore.update((book) => {
    const current = book[symbol] ?? emptyNote(now);
    if (current.entries.some((e) => e.at === entry.at)) return book;
    const entries = [...current.entries, entry].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ENTRIES);
    return { ...book, [symbol]: { ...current, entries, updatedAt: now.toISOString() } };
  });
}

/** Removes one entry, identified by its time stamp. */
export function removeNoteEntry(symbol: string, at: string, now = new Date()): void {
  notesStore.update((book) => {
    const current = book[symbol];
    if (!current) return book;
    const next = { ...current, entries: current.entries.filter((e) => e.at !== at), updatedAt: now.toISOString() };
    const copy = { ...book };
    if (isEmptyNote(next)) delete copy[symbol];
    else copy[symbol] = next;
    return copy;
  });
}

export function removeNote(symbol: string): void {
  notesStore.update((book) => {
    if (!(symbol in book)) return book;
    const copy = { ...book };
    delete copy[symbol];
    return copy;
  });
}

/** Puts back a whole note (the Undo of removeNote). */
export function restoreNote(symbol: string, note: SymbolNote): void {
  notesStore.update((book) => {
    const clean = sanitizeNote(note);
    return clean && !isEmptyNote(clean) ? { ...book, [symbol]: clean } : book;
  });
}

// ---------------------------------------------------------------------------
// Reading notes: levels, review dates, tags
// ---------------------------------------------------------------------------

/**
 * Signed distance of a level from the price, in percent of the price: +28.6 means the level sits 28.6% above the
 * price, -8.9 that it sits 8.9% below. Null when either number is missing or not positive.
 */
export function levelDistance(level: number | null | undefined, price: number | null | undefined): number | null {
  if (!isPositive(level) || !isPositive(price)) return null;
  return (level / price - 1) * 100;
}

/**
 * Calendar days from today to the review date in the investor's own calendar: 0 on the day, negative once it has
 * passed (-3 = three days overdue). Null without a valid date.
 */
export function reviewDaysLeft(reviewBy: string | null | undefined, now: Date): number | null {
  if (!isIsoDate(reviewBy)) return null;
  const [y, m, d] = reviewBy.split("-").map(Number);
  const due = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / DAY_MS);
}

/** Review state of a note for lists and badges; "soon" is within the next 7 days. */
export type ReviewStatus = "none" | "overdue" | "today" | "soon" | "later";

export function reviewStatus(reviewBy: string | null | undefined, now: Date): ReviewStatus {
  const days = reviewDaysLeft(reviewBy, now);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= 7 ? "soon" : "later";
}

/** Symbols whose review date is today or has passed, most overdue first. */
export function notesDueForReview(book: NotesBook, now: Date): string[] {
  return Object.entries(book)
    .map(([symbol, note]) => ({ symbol, days: reviewDaysLeft(note.reviewBy, now) }))
    .filter((row): row is { symbol: string; days: number } => row.days !== null && row.days <= 0)
    .sort((a, b) => a.days - b.days || a.symbol.localeCompare(b.symbol))
    .map((row) => row.symbol);
}

/** Order for the notes list: overdue first (most overdue first), then the nearest review, then notes without a date. */
export function compareByReview(a: Pick<SymbolNote, "reviewBy">, b: Pick<SymbolNote, "reviewBy">, now: Date): number {
  const da = reviewDaysLeft(a.reviewBy, now);
  const db = reviewDaysLeft(b.reviewBy, now);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db;
}

/** Every tag in the book with the number of notes carrying it, most used first, then alphabetically. */
export function tagCounts(book: NotesBook): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const note of Object.values(book)) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Adds tags typed in the editor (comma separated) to a tag list: normalized, without duplicates, capped at MAX_TAGS. */
export function mergeTags(current: readonly string[], input: string): string[] {
  const added = input.split(/[,，]/).map(normalizeTag).filter(Boolean);
  return [...new Set([...current, ...added])].slice(0, MAX_TAGS);
}

/** The first line of a thesis, shortened to about `max` characters on a word boundary, with an ellipsis when cut. */
export function thesisExcerpt(thesis: string, max = 140): string {
  const firstLine = thesis.trim().split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (firstLine.length <= max) return firstLine;
  const cut = firstLine.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
