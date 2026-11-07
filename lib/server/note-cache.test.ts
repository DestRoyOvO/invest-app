import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_STREAM_ERROR, AI_STREAM_TRUNCATED } from "@/types/api";

import { clearNoteCache, NOTE_CACHE_TTL_MS, noteCacheKey, readCachedNote, storeNote, teeOnComplete, textStream } from "./note-cache";

function chunks(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

beforeEach(() => clearNoteCache());

describe("note cache", () => {
  it("keys notes by kind, structure, language and the exact context text", () => {
    const base = { kind: "stock", spec: "equity", lang: "en", context: "Stock: NVDA ..." };
    const key = noteCacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(noteCacheKey({ ...base })).toBe(key);
    expect(noteCacheKey({ ...base, lang: "zh" })).not.toBe(key);
    expect(noteCacheKey({ ...base, kind: "move" })).not.toBe(key);
    expect(noteCacheKey({ ...base, spec: "fund" })).not.toBe(key);
    expect(noteCacheKey({ ...base, context: "Stock: NVDA ...." })).not.toBe(key);
  });

  it("serves a stored note for 15 minutes", () => {
    storeNote("k", { text: "## Bottom line", createdAt: "2026-11-07T14:00:00.000Z" }, 1_000);
    expect(readCachedNote("k", 1_000 + NOTE_CACHE_TTL_MS - 1)).toEqual({ text: "## Bottom line", createdAt: "2026-11-07T14:00:00.000Z" });
    expect(readCachedNote("k", 1_000 + NOTE_CACHE_TTL_MS)).toBeNull();
    expect(readCachedNote("missing")).toBeNull();
  });

  it("never stores an empty or failed note, but keeps a truncated one with its marker", () => {
    storeNote("empty", { text: "  ", createdAt: "t" });
    storeNote("failed", { text: `partial${AI_STREAM_ERROR}upstream_error`, createdAt: "t" });
    storeNote("cut", { text: `long note${AI_STREAM_TRUNCATED}`, createdAt: "t" });
    expect(readCachedNote("empty")).toBeNull();
    expect(readCachedNote("failed")).toBeNull();
    expect(readCachedNote("cut")?.text).toBe(`long note${AI_STREAM_TRUNCATED}`);
  });

  it("drops the oldest notes beyond its size limit", () => {
    for (let i = 0; i < 205; i++) storeNote(`n${i}`, { text: `note ${i}`, createdAt: "t" });
    expect(readCachedNote("n0")).toBeNull();
    expect(readCachedNote("n4")).toBeNull();
    expect(readCachedNote("n5")?.text).toBe("note 5");
    expect(readCachedNote("n204")?.text).toBe("note 204");
  });

  it("passes a stream through unchanged and reports the whole text when it ends", async () => {
    const done = vi.fn();
    const stream = teeOnComplete(chunks(["## Bottom", " line", " 中文"]), done);
    expect(await new Response(stream).text()).toBe("## Bottom line 中文");
    expect(done).toHaveBeenCalledWith("## Bottom line 中文");
  });

  it("reports nothing when the reader cancels", async () => {
    const done = vi.fn();
    const encoder = new TextEncoder();
    // A model stream that is still going when the reader leaves.
    const endless = new ReadableStream<Uint8Array>({ pull: (controller) => controller.enqueue(encoder.encode("x")) });
    const reader = teeOnComplete(endless, done).getReader();
    await reader.read();
    await reader.cancel();
    expect(done).not.toHaveBeenCalled();
  });

  it("replays a finished text as a stream", async () => {
    expect(await new Response(textStream("cached note")).text()).toBe("cached note");
  });
});
