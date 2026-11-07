import "server-only";

import { createHash } from "node:crypto";

import { AI_STREAM_ERROR } from "@/types/api";

// Finished research notes, kept in memory for 15 minutes and keyed by a SHA-256 of the note kind, the language and
// the exact context text. A note asked for again on identical data (common while the market is closed, or after a
// reload) is served at once without a model call. Regenerate sends force: true and skips the cache. Only notes that
// streamed to the end without an error marker are stored; a truncated note is stored with its truncation marker.

export const NOTE_CACHE_TTL_MS = 15 * 60_000;
const MAX_NOTES = 200;

export interface CachedNote {
  /** The streamed body as sent, including a trailing AI_STREAM_TRUNCATED marker. */
  text: string;
  /** ISO time the note was written. */
  createdAt: string;
}

interface Entry extends CachedNote {
  expiresAt: number;
}

const globalStore = globalThis as unknown as { __investseekNotes?: Map<string, Entry> };
const store: Map<string, Entry> = (globalStore.__investseekNotes ??= new Map());

/** Cache key of a note: the kind (with the note structure), the language and the exact context text. */
export function noteCacheKey(parts: { kind: string; spec?: string; lang: string; context: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([parts.kind, parts.spec ?? "", parts.lang, parts.context]))
    .digest("hex");
}

export function readCachedNote(key: string, now: number = Date.now()): CachedNote | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return { text: entry.text, createdAt: entry.createdAt };
}

export function storeNote(key: string, note: CachedNote, now: number = Date.now()): void {
  if (!note.text.trim() || note.text.includes(AI_STREAM_ERROR)) return;
  store.delete(key);
  store.set(key, { ...note, expiresAt: now + NOTE_CACHE_TTL_MS });
  for (const [oldKey, entry] of store) if (entry.expiresAt <= now) store.delete(oldKey);
  // Still too many: drop the oldest insertions (Map iterates in insertion order).
  while (store.size > MAX_NOTES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Test helper. */
export function clearNoteCache(): void {
  store.clear();
}

/**
 * Passes a model stream through unchanged and, when it ends normally, hands the whole text to `onComplete`. A stream
 * that is cancelled (the reader went away) never completes, so nothing partial is stored.
 */
export function teeOnComplete(stream: ReadableStream<Uint8Array>, onComplete: (text: string) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let text = "";
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        text += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      flush() {
        text += decoder.decode();
        onComplete(text);
      },
    }),
  );
}

/** A finished text as a byte stream (a cached note replayed in the same format as a live one). */
export function textStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
