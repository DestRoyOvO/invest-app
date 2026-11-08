// Backup, restore and merge of everything InvestSeek keeps in this browser: every localStorage key under
// STORAGE_PREFIX and the display preference cookies. The functions work on a storage-like object and plain values, so
// they are unit tested without a browser; browserEnv() wires them to localStorage, document.cookie and the stores.
//
// A backup file is { app: "investseek", schema: 1, exportedAt, data: { storage, text, cookies } }:
// - storage: JSON values by key (the watchlist, positions, notes and every other store);
// - text: values that are not JSON, by key (the last viewed symbol is stored as a bare string);
// - cookies: the display preferences (language, theme, price colors, density).
// This browser's backup bookkeeping (META_STORAGE_KEY) is never exported or restored.
//
// A restore is previewed first: per store, what it would add, change and remove. Then it is applied atomically: every
// key is written, or after a failure (a full storage) the keys already written are put back and nothing has changed;
// only then are the stores in this tab told. Other tabs follow through the browser's own storage events.
//
// Merge rules: the watchlist becomes the union (this browser's order first, capped at MAX_WATCHLIST); positions from
// the file win per symbol; per symbol, the note with the newer updatedAt wins; every other store is replaced by the
// file's copy. Replace makes this browser match the file, removing keys the file does not have.
//
// The file is validated with zod (components/data/backup-schema.ts), which is loaded only when a file is checked, so
// validateBackup is async: the settings menu on every page imports this module for the backup age, and should not
// download a validator.

import { HOLDINGS_STORAGE_KEY, sanitizeHoldings, type Holdings } from "@/hooks/useHoldings";
import { sanitizeWatchlist, WATCHLIST_STORAGE_KEY } from "@/hooks/useWatchlist";

import { createLocalStore, registeredLocalStores, STORAGE_PREFIX, type LocalStore } from "./local-store";
import { NOTES_STORAGE_KEY, sanitizeNotes, type NotesBook, type SymbolNote } from "./notes";
import { PREF_COOKIE_MAX_AGE } from "./prefs";
import { DEFAULT_WATCHLIST, MAX_WATCHLIST } from "./universe";

export const BACKUP_APP = "investseek";
export const BACKUP_SCHEMA = 1;
/** This browser's backup bookkeeping (the last backup time). Never exported or restored. */
export const META_STORAGE_KEY = `${STORAGE_PREFIX}meta:v1`;
/** The largest backup accepted, in characters: about what localStorage holds for one site. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_KEYS = 1000;
/** The longest plain-text value accepted in a backup file. */
export const MAX_TEXT_CHARS = 100_000;
/** Nesting limit for a backup file. Real stores nest less than ten levels; a deeper file is not ours. */
const MAX_DEPTH = 64;

export const PREF_COOKIE_NAMES = ["is_lang", "is_theme", "is_updown", "is_density"] as const;
export type PrefCookieName = (typeof PREF_COOKIE_NAMES)[number];
export type PrefCookies = Partial<Record<PrefCookieName, string>>;
/** Preference values are short lowercase words ("zh", "dark", "cb", "compact"), which also keeps them safe in a cookie. */
export const COOKIE_VALUE = /^[a-z]{1,16}$/;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface Backup {
  app: typeof BACKUP_APP;
  schema: typeof BACKUP_SCHEMA;
  /** ISO time the backup was made. */
  exportedAt: string;
  data: {
    /** localStorage values that are JSON, by key. */
    storage: Record<string, JsonValue>;
    /** localStorage values that are plain text rather than JSON, by key. */
    text: Record<string, string>;
    /** Display preference cookies. */
    cookies: PrefCookies;
  };
}

/** The parts of the DOM Storage interface a backup uses: localStorage, or a fake in tests. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Raw values of the app's keys, as stored. */
export type StorageSnapshot = Readonly<Record<string, string>>;

export type StoreRegistry = ReadonlyMap<string, LocalStore<unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseJson(raw: string): { ok: true; value: JsonValue } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as JsonValue };
  } catch {
    return { ok: false };
  }
}

/** The stored value parsed as JSON, or `fallback` when it is missing or not JSON. */
function parsedOr<T>(raw: string | undefined, fallback: T): JsonValue | T {
  if (raw === undefined) return fallback;
  const parsed = parseJson(raw);
  return parsed.ok ? parsed.value : fallback;
}

/** Every key under STORAGE_PREFIX with its raw value; the backup bookkeeping only when asked. */
export function readStorage(storage: StorageLike, options: { includeMeta?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX) || (key === META_STORAGE_KEY && !options.includeMeta)) continue;
    const value = storage.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** The preference cookies in a document.cookie string; other cookies and unexpected values are ignored. */
export function readPrefCookies(cookieString: string): PrefCookies {
  const out: PrefCookies = {};
  for (const part of cookieString.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if ((PREF_COOKIE_NAMES as readonly string[]).includes(name) && COOKIE_VALUE.test(value)) out[name as PrefCookieName] = value;
  }
  return out;
}

/** Builds a backup of the given stored values and preference cookies. */
export function createBackup(snapshot: StorageSnapshot, cookies: PrefCookies, now: Date = new Date()): Backup {
  const storage: Record<string, JsonValue> = {};
  const text: Record<string, string> = {};
  for (const key of Object.keys(snapshot).sort()) {
    if (!key.startsWith(STORAGE_PREFIX) || key === META_STORAGE_KEY) continue;
    const parsed = parseJson(snapshot[key]);
    if (parsed.ok) storage[key] = parsed.value;
    else text[key] = snapshot[key];
  }
  const prefs: PrefCookies = {};
  for (const name of PREF_COOKIE_NAMES) {
    const value = cookies[name];
    if (value && COOKIE_VALUE.test(value)) prefs[name] = value;
  }
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: now.toISOString(), data: { storage, text, cookies: prefs } };
}

/** The backup as the text of a .json file. */
export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/** YYYY-MM-DD in local time. */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "investseek-backup-2026-11-07.json", by the local date. */
export function backupFileName(now: Date = new Date()): string {
  return `investseek-backup-${localDate(now)}.json`;
}

type BackupSchema = (typeof import("@/components/data/backup-schema"))["backupFileSchema"];
let backupSchema: Promise<BackupSchema> | null = null;

/**
 * The zod schema of a backup file, from a module of its own: a dynamic import keeps zod out of the bundles of the
 * pages that import this file only for the backup age or the export, and the module's static named imports let the
 * bundler drop the parts of zod the schema does not use (a dynamic import of zod itself would bring all of it).
 */
function loadBackupSchema(): Promise<BackupSchema> {
  // A failed load (offline, or a deploy replaced the chunk) is not kept, so the next file tries again.
  backupSchema ??= import("@/components/data/backup-schema").then(
    (module) => module.backupFileSchema,
    (error: unknown) => {
      backupSchema = null;
      throw error;
    },
  );
  return backupSchema;
}

/** check_failed: the validator itself could not be loaded, which says nothing about the file. */
export type BackupError = "too_large" | "not_json" | "not_backup" | "newer_schema" | "invalid" | "check_failed";

/** The deepest nesting of arrays and objects in JSON text, skipping strings. */
function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (inString) {
      if (code === 92) i++; // a backslash escapes the next character
      else if (code === 34) inString = false;
    } else if (code === 34) {
      inString = true;
    } else if (code === 91 || code === 123) {
      depth++;
      if (depth > max) max = depth;
    } else if (code === 93 || code === 125) {
      depth--;
    }
  }
  return max;
}

/**
 * Checks that a file is an InvestSeek backup this version can read: valid JSON, the app marker, a schema no newer
 * than BACKUP_SCHEMA, keys inside STORAGE_PREFIX only, JSON values, and preference cookies that are short words.
 * Files that fail the quick checks are refused before the schema (and zod) is loaded.
 */
export async function validateBackup(text: string): Promise<{ ok: true; backup: Backup } | { ok: false; error: BackupError }> {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: "too_large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not_json" };
  }
  if (!isRecord(raw) || raw.app !== BACKUP_APP) return { ok: false, error: "not_backup" };
  if (typeof raw.schema === "number" && raw.schema > BACKUP_SCHEMA) return { ok: false, error: "newer_schema" };
  if (jsonDepth(text) > MAX_DEPTH) return { ok: false, error: "invalid" };
  let schema: BackupSchema;
  try {
    schema = await loadBackupSchema();
  } catch {
    return { ok: false, error: "check_failed" };
  }
  let parsed: ReturnType<BackupSchema["safeParse"]>;
  try {
    parsed = schema.safeParse(raw);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (!parsed.success) return { ok: false, error: "invalid" };
  const storage = { ...(parsed.data.data.storage as Record<string, JsonValue>) };
  const texts = { ...parsed.data.data.text };
  delete storage[META_STORAGE_KEY];
  delete texts[META_STORAGE_KEY];
  for (const key of Object.keys(texts)) if (key in storage) delete texts[key];
  if (Object.keys(storage).length + Object.keys(texts).length > MAX_KEYS) return { ok: false, error: "invalid" };
  const cookies: PrefCookies = {};
  for (const name of PREF_COOKIE_NAMES) {
    const value = parsed.data.data.cookies[name];
    if (value) cookies[name] = value;
  }
  return { ok: true, backup: { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: parsed.data.exportedAt, data: { storage, text: texts, cookies } } };
}

export type RestoreMode = "merge" | "replace";

export type StoreKind = "watchlist" | "holdings" | "notes" | "store" | "other";

export interface StoreDiff {
  key: string;
  kind: StoreKind;
  /** What the restore adds, changes and removes: symbols for the watchlist, positions and notes; entry keys or ids otherwise. */
  added: string[];
  changed: string[];
  removed: string[];
  /** Entries in the file that failed validation and are left out. */
  invalid: number;
  /** True when the file's copy of this store is unusable (wrong shape); this browser's copy is kept as it is. */
  rejected: boolean;
  /** Merge only: notes kept because the copy in this browser is newer. */
  keptLocal: string[];
  /** Merge only: watchlist symbols that did not fit under MAX_WATCHLIST. */
  overflow: string[];
}

export function hasChanges(diff: StoreDiff): boolean {
  return diff.added.length + diff.changed.length + diff.removed.length > 0;
}

interface Changes {
  added: string[];
  changed: string[];
  removed: string[];
}

function noChanges(): Changes {
  return { added: [], changed: [], removed: [] };
}

function diffRecords(before: Record<string, unknown>, after: Record<string, unknown>): Changes {
  return {
    added: Object.keys(after).filter((key) => !(key in before)),
    changed: Object.keys(after).filter((key) => key in before && !same(before[key], after[key])),
    removed: Object.keys(before).filter((key) => !(key in after)),
  };
}

function itemId(item: unknown): string | null {
  return isRecord(item) && (typeof item.id === "string" || typeof item.id === "number") ? String(item.id) : null;
}

function itemLabel(text: string): string {
  const parsed = parseJson(text);
  return parsed.ok && typeof parsed.value === "string" ? parsed.value : text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function diffArrays(before: readonly unknown[], after: readonly unknown[]): Changes {
  if ([...before, ...after].every((item) => itemId(item) !== null)) {
    const byId = (items: readonly unknown[]) => Object.fromEntries(items.map((item) => [itemId(item) as string, item]));
    return diffRecords(byId(before), byId(after));
  }
  // Items without ids are compared by value, counting repeats.
  const count = (items: readonly unknown[]) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(JSON.stringify(item), (counts.get(JSON.stringify(item)) ?? 0) + 1);
    return counts;
  };
  const b = count(before);
  const a = count(after);
  const extra = (from: Map<string, number>, other: Map<string, number>) =>
    [...from].flatMap(([text, n]) => Array.from({ length: Math.max(0, n - (other.get(text) ?? 0)) }, () => itemLabel(text)));
  return { added: extra(a, b), changed: [], removed: extra(b, a) };
}

/** What changes between two values of a store: entries of objects, items of arrays, or the value as a whole. */
function diffValues(before: unknown, after: unknown, label: string): Changes {
  const sample = after ?? before;
  if (isRecord(sample) && (before === undefined || isRecord(before)) && (after === undefined || isRecord(after))) {
    return diffRecords(before ?? {}, after ?? {});
  }
  if (Array.isArray(sample) && (before === undefined || Array.isArray(before)) && (after === undefined || Array.isArray(after))) {
    return diffArrays(before ?? [], after ?? []);
  }
  if (before === undefined && after === undefined) return noChanges();
  if (before === undefined) return { added: [label], changed: [], removed: [] };
  if (after === undefined) return { added: [], changed: [], removed: [label] };
  return same(before, after) ? noChanges() : { added: [], changed: [label], removed: [] };
}

/** Union of two watchlists: this browser's order first, then the new symbols, capped. */
export function mergeWatchlist(current: readonly string[], incoming: readonly string[], cap: number = MAX_WATCHLIST): { list: string[]; overflow: string[] } {
  const list = [...current];
  const overflow: string[] = [];
  for (const symbol of incoming) {
    if (list.includes(symbol)) continue;
    if (list.length >= cap) overflow.push(symbol);
    else list.push(symbol);
  }
  return { list, overflow };
}

/** Positions after an import or restore: merge keeps other positions and lets the incoming ones win per symbol. */
export function mergeHoldings(current: Holdings, incoming: Holdings, mode: RestoreMode): Holdings {
  return mode === "merge" ? { ...current, ...incoming } : { ...incoming };
}

/** Positions added, updated and removed between two holdings. */
export function diffHoldings(before: Holdings, after: Holdings): { added: string[]; updated: string[]; removed: string[] } {
  const { added, changed, removed } = diffRecords(before, after);
  return { added, updated: changed, removed };
}

/** Per symbol, the note with the newer updatedAt wins; ties keep this browser's note. */
export function mergeNotes(current: NotesBook, incoming: NotesBook): { book: Record<string, SymbolNote>; keptLocal: string[] } {
  const book: Record<string, SymbolNote> = { ...current };
  const keptLocal: string[] = [];
  for (const [symbol, note] of Object.entries(incoming)) {
    const mine = current[symbol];
    if (!mine || Date.parse(note.updatedAt) > Date.parse(mine.updatedAt)) book[symbol] = note;
    else if (!same(mine, note)) keptLocal.push(symbol);
  }
  return { book, keptLocal };
}

const KIND_ORDER: Record<StoreKind, number> = { watchlist: 0, holdings: 1, notes: 2, store: 3, other: 3 };

function kindOf(key: string, stores: StoreRegistry): StoreKind {
  if (key === WATCHLIST_STORAGE_KEY) return "watchlist";
  if (key === HOLDINGS_STORAGE_KEY) return "holdings";
  if (key === NOTES_STORAGE_KEY) return "notes";
  return stores.has(key) ? "store" : "other";
}

interface Restored {
  next: Record<string, string>;
  diffs: StoreDiff[];
}

function restoreState(current: StorageSnapshot, backup: Backup, mode: RestoreMode, stores: StoreRegistry): Restored {
  const next: Record<string, string> = mode === "merge" ? { ...current } : {};
  const { storage, text } = backup.data;
  const keys = new Set([...Object.keys(storage), ...Object.keys(text), ...(mode === "replace" ? Object.keys(current) : [])]);
  keys.delete(META_STORAGE_KEY);
  const diffs: StoreDiff[] = [];

  for (const key of keys) {
    const kind = kindOf(key, stores);
    const raw = current[key];
    const inFile = key in storage || key in text;
    const diff: StoreDiff = { key, kind, ...noChanges(), invalid: 0, rejected: false, keptLocal: [], overflow: [] };
    const keep = () => {
      if (raw !== undefined) next[key] = raw;
    };
    const set = (value: unknown) => {
      next[key] = JSON.stringify(value);
    };

    // A value the app reads as JSON but the file has as plain text, or a known store of the wrong shape, is unusable:
    // this browser's copy stays as it is.
    const incoming = storage[key];
    const wrongShape =
      inFile &&
      ((kind !== "other" && !(key in storage)) ||
        (kind === "watchlist" && !Array.isArray(incoming)) ||
        ((kind === "holdings" || kind === "notes") && !isRecord(incoming)));
    if (wrongShape) {
      keep();
      diffs.push({ ...diff, rejected: true });
      continue;
    }

    if (kind === "watchlist") {
      // Without a stored list the app shows the starter list, so that is what a change is measured against.
      const before = raw === undefined ? [...DEFAULT_WATCHLIST] : sanitizeWatchlist(parsedOr(raw, null));
      let after = before;
      if (inFile) {
        const list = sanitizeWatchlist(incoming);
        diff.invalid = Math.max(0, (incoming as unknown[]).length - list.length);
        if (mode === "merge") {
          const merged = mergeWatchlist(before, list);
          after = merged.list;
          diff.overflow = merged.overflow;
        } else {
          after = list;
        }
        set(after);
      } else if (mode === "replace") {
        after = [...DEFAULT_WATCHLIST];
      } else {
        keep();
      }
      diffs.push({ ...diff, ...diffArrays(before, after) });
    } else if (kind === "holdings") {
      const before = raw === undefined ? {} : sanitizeHoldings(parsedOr(raw, null));
      let after: Holdings = mode === "replace" ? {} : before;
      if (inFile) {
        const positions = sanitizeHoldings(incoming);
        diff.invalid = Math.max(0, Object.keys(incoming as object).length - Object.keys(positions).length);
        after = mergeHoldings(before, positions, mode);
        set(after);
      } else if (mode === "merge") {
        keep();
      }
      diffs.push({ ...diff, ...diffRecords(before, after) });
    } else if (kind === "notes") {
      const before = raw === undefined ? {} : sanitizeNotes(parsedOr(raw, null));
      let after: NotesBook = mode === "replace" ? {} : before;
      if (inFile) {
        const notes = sanitizeNotes(incoming);
        diff.invalid = Math.max(0, Object.keys(incoming as object).length - Object.keys(notes).length);
        if (mode === "merge") {
          const merged = mergeNotes(before, notes);
          after = merged.book;
          diff.keptLocal = merged.keptLocal;
        } else {
          after = notes;
        }
        set(after);
      } else if (mode === "merge") {
        keep();
      }
      diffs.push({ ...diff, ...diffRecords(before, after) });
    } else if (kind === "store") {
      const store = stores.get(key) as LocalStore<unknown>;
      const before = raw === undefined ? undefined : store.sanitize(parsedOr(raw, null));
      let after: unknown = mode === "replace" ? undefined : before;
      if (inFile) {
        after = store.sanitize(incoming);
        set(after);
      } else if (mode === "merge") {
        keep();
      }
      diffs.push({ ...diff, ...diffValues(before, after, key) });
    } else {
      // Unknown keys: JSON values are compared as JSON, plain text as text.
      const before = raw === undefined ? undefined : key in text ? raw : parsedOr(raw, raw);
      let after: unknown = mode === "replace" ? undefined : before;
      if (key in storage) {
        after = incoming;
        set(incoming);
      } else if (key in text) {
        after = text[key];
        next[key] = text[key];
      } else if (mode === "merge") {
        keep();
      }
      diffs.push({ ...diff, ...diffValues(before, after, key) });
    }
  }

  diffs.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.key.localeCompare(b.key));
  return { next, diffs };
}

/** What a restore in the given mode would change in the given storage, per store. */
export function diffRestore(current: StorageSnapshot, backup: Backup, mode: RestoreMode, stores: StoreRegistry = registeredLocalStores()): StoreDiff[] {
  return restoreState(current, backup, mode, stores).diffs;
}

export interface ParsedBackup {
  backup: Backup;
  /** What each mode would change in the storage it was checked against. */
  diff: Record<RestoreMode, StoreDiff[]>;
}

/** Validates a backup file and previews both restore modes against the current storage. */
export async function parseBackup(
  text: string,
  current: StorageSnapshot,
  stores: StoreRegistry = registeredLocalStores(),
): Promise<{ ok: true; value: ParsedBackup } | { ok: false; error: BackupError }> {
  const result = await validateBackup(text);
  if (!result.ok) return result;
  const { backup } = result;
  return { ok: true, value: { backup, diff: { merge: diffRestore(current, backup, "merge", stores), replace: diffRestore(current, backup, "replace", stores) } } };
}

export interface PrefChange {
  name: PrefCookieName;
  from: string | null;
  to: string;
}

/** Preference cookies in the backup that differ from the current ones. */
export function prefChanges(backup: Backup, current: PrefCookies): PrefChange[] {
  return PREF_COOKIE_NAMES.flatMap((name) => {
    const to = backup.data.cookies[name];
    return to && to !== current[name] ? [{ name, from: current[name] ?? null, to }] : [];
  });
}

export interface RestorePlan {
  /** New raw values by key (null removes the key); only keys whose value changes. */
  writes: Record<string, string | null>;
  /** Preference cookies to set. */
  cookies: PrefCookies;
  diffs: StoreDiff[];
}

/** The writes a restore makes. Preference cookies are included only when `cookies` (the current ones) is given. */
export function planRestore(
  current: StorageSnapshot,
  backup: Backup,
  mode: RestoreMode,
  options: { stores?: StoreRegistry; cookies?: PrefCookies | null } = {},
): RestorePlan {
  const { next, diffs } = restoreState(current, backup, mode, options.stores ?? registeredLocalStores());
  const writes: Record<string, string | null> = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    const value = key in next ? next[key] : null;
    if ((current[key] ?? null) !== value) writes[key] = value;
  }
  const cookies: PrefCookies = {};
  if (options.cookies) for (const change of prefChanges(backup, options.cookies)) cookies[change.name] = change.to;
  return { writes, cookies, diffs };
}

export interface StorageChange {
  key: string;
  oldValue: string | null;
  newValue: string | null;
}

export class StorageWriteError extends Error {
  constructor(readonly reason: "quota" | "unavailable") {
    super(reason === "quota" ? "Browser storage is full" : "Browser storage is unavailable");
    this.name = "StorageWriteError";
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof Error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || /quota/i.test(error.message));
}

/**
 * Writes every value or none: when a write fails (a full or blocked storage), the keys already written get their old
 * values back and a StorageWriteError is thrown. Removals go first, so a full storage has room for the new values.
 * Keys outside STORAGE_PREFIX are refused.
 */
export function writeAtomically(storage: StorageLike, writes: Readonly<Record<string, string | null>>): StorageChange[] {
  const entries = Object.entries(writes).sort(([, a], [, b]) => Number(a !== null) - Number(b !== null));
  const applied: StorageChange[] = [];
  try {
    for (const [key, value] of entries) {
      if (!key.startsWith(STORAGE_PREFIX)) throw new Error(`Refusing to write ${key}`);
      const oldValue = storage.getItem(key);
      if (oldValue === value) continue;
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      applied.push({ key, oldValue, newValue: value });
    }
  } catch (error) {
    for (const change of [...applied].reverse()) {
      try {
        if (change.oldValue === null) storage.removeItem(change.key);
        else storage.setItem(change.key, change.oldValue);
      } catch {
        // Best effort: the value could not be put back either.
      }
    }
    throw new StorageWriteError(isQuotaError(error) ? "quota" : "unavailable");
  }
  return applied;
}

/** Sets a preference cookie the way the preferences provider does: for a year, for the whole site. Odd values are ignored. */
export function writePrefCookie(name: PrefCookieName, value: string): void {
  if (COOKIE_VALUE.test(value)) document.cookie = `${name}=${value}; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Where a restore reads and writes: the browser (browserEnv) or fakes in tests. */
export interface BackupEnv {
  storage: StorageLike;
  readCookies(): PrefCookies;
  writeCookie(name: PrefCookieName, value: string): void;
  /** Tells this tab's stores about changed keys; other tabs get the browser's own storage events. */
  notify(changes: readonly StorageChange[]): void;
  /** The stores whose sanitize applies to their keys (default: every store created in this page). */
  stores?: StoreRegistry;
}

/**
 * The real environment. Stores in this tab hear about a change through a storage event dispatched on window, the
 * same event other tabs receive from the browser, so every store (useWatchlist, useHoldings, lib/local-store.ts)
 * re-reads its key without needing a new API.
 */
export function browserEnv(): BackupEnv {
  return {
    storage: window.localStorage,
    readCookies: () => readPrefCookies(document.cookie),
    writeCookie: writePrefCookie,
    notify: (changes) => {
      for (const change of changes) {
        window.dispatchEvent(
          new StorageEvent("storage", { key: change.key, oldValue: change.oldValue, newValue: change.newValue, storageArea: window.localStorage, url: window.location.href }),
        );
      }
    },
  };
}

export interface CookieChange {
  name: PrefCookieName;
  oldValue: string | null;
  newValue: string;
}

export interface RestoreResult {
  changes: StorageChange[];
  cookies: CookieChange[];
  diffs: StoreDiff[];
}

/**
 * Restores a backup against the latest stored values: plans the writes, applies them atomically (throws
 * StorageWriteError with nothing changed when storage refuses), sets the preference cookies when `prefs` is true, and
 * then notifies the stores.
 */
export function applyBackup(backup: Backup, mode: RestoreMode, env: BackupEnv, options: { prefs?: boolean } = {}): RestoreResult {
  const currentCookies = env.readCookies();
  const plan = planRestore(readStorage(env.storage), backup, mode, { stores: env.stores, cookies: options.prefs ? currentCookies : null });
  const changes = writeAtomically(env.storage, plan.writes);
  const cookies: CookieChange[] = [];
  for (const name of PREF_COOKIE_NAMES) {
    const value = plan.cookies[name];
    if (value === undefined) continue;
    env.writeCookie(name, value);
    cookies.push({ name, oldValue: currentCookies[name] ?? null, newValue: value });
  }
  env.notify(changes);
  return { changes, cookies, diffs: plan.diffs };
}

/** Writes raw values atomically (null removes a key) and notifies the stores. */
export function applyWrites(env: BackupEnv, writes: Readonly<Record<string, string | null>>): StorageChange[] {
  const changes = writeAtomically(env.storage, writes);
  env.notify(changes);
  return changes;
}

/** Puts back what a set of changes replaced, for the keys nobody has changed since; returns what was reverted. */
export function undoChanges(env: BackupEnv, changes: readonly StorageChange[]): StorageChange[] {
  const writes: Record<string, string | null> = {};
  for (const change of changes) if (env.storage.getItem(change.key) === change.newValue) writes[change.key] = change.oldValue;
  return applyWrites(env, writes);
}

/** Removes every key under STORAGE_PREFIX, the backup bookkeeping included. Cookies are left alone. */
export function clearAllData(env: BackupEnv): StorageChange[] {
  const writes: Record<string, null> = {};
  for (const key of Object.keys(readStorage(env.storage, { includeMeta: true }))) writes[key] = null;
  return applyWrites(env, writes);
}

export interface BackupMeta {
  /** ISO time of the last export from this browser. */
  lastBackupAt: string | null;
}

const EMPTY_META: BackupMeta = { lastBackupAt: null };

export function sanitizeBackupMeta(raw: unknown): BackupMeta {
  const at = isRecord(raw) ? raw.lastBackupAt : null;
  return typeof at === "string" && !Number.isNaN(Date.parse(at)) ? { lastBackupAt: at } : EMPTY_META;
}

/** When this browser last exported a backup (for "Last backup N days ago"). */
export const backupMetaStore = createLocalStore<BackupMeta>({ key: META_STORAGE_KEY, sanitize: sanitizeBackupMeta, empty: EMPTY_META });

export function recordBackup(now: Date = new Date()): void {
  backupMetaStore.write({ lastBackupAt: now.toISOString() });
}

/** Whole calendar days (local time) from the last backup to now: 0 today, 1 yesterday; null when there was none. */
export function backupAgeDays(lastBackupAt: string | null, now: Date = new Date()): number | null {
  if (!lastBackupAt) return null;
  const then = new Date(lastBackupAt);
  if (Number.isNaN(then.getTime())) return null;
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.max(0, Math.round((day(now) - day(then)) / 86_400_000));
}

/** The store name inside a key: "investseek:alert-log:v1" gives "alert-log". */
export function storeName(key: string): string {
  return key.slice(key.startsWith(STORAGE_PREFIX) ? STORAGE_PREFIX.length : 0).replace(/:v\d+$/, "");
}

/** Entries in a stored value: items of an array or keys of an object; null for a single value. */
export function countEntries(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return null;
}

/** UTF-8 size of a text, as it takes up in an exported file. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** "512 B", "3.4 KB", "1.2 MB" (binary units). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface StoredItem {
  key: string;
  /** Parsed JSON, or the raw text when the value is not JSON. */
  value: JsonValue;
  /** Size of the key and value in an export. */
  bytes: number;
}

/** The stored keys with their values and sizes, known stores first. */
export function storedItems(snapshot: StorageSnapshot): StoredItem[] {
  const order = (key: string) => [WATCHLIST_STORAGE_KEY, HOLDINGS_STORAGE_KEY, NOTES_STORAGE_KEY].indexOf(key);
  return Object.keys(snapshot)
    .filter((key) => key !== META_STORAGE_KEY)
    .sort((a, b) => {
      const [x, y] = [order(a), order(b)];
      return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b);
    })
    .map((key) => ({ key, value: parsedOr(snapshot[key], snapshot[key]), bytes: byteLength(key) + byteLength(snapshot[key]) }));
}
