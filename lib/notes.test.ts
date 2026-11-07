import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addNoteEntry, isEmptyNote, MAX_ENTRIES, notesStore, removeNote, removeNoteEntry, sanitizeNotes, updateNote, emptyNote } from "./notes";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-11-07T15:00:00Z");

describe("sanitizeNotes", () => {
  it("keeps valid notes and drops invalid symbols, fields and empty notes", () => {
    const book = sanitizeNotes({
      nvda: {
        thesis: "AI capex cycle",
        conviction: 4,
        target: 240,
        stop: -5,
        reviewBy: "2027-01-31",
        tags: ["ai", "ai", "  semis  ", 3],
        entries: [
          { at: "2026-11-01T10:00:00Z", price: 180, text: "older", kind: "note" },
          { at: "2026-11-05T10:00:00Z", price: "bad", text: "newer", kind: "ai" },
          { at: "not a date", text: "dropped" },
          { at: "2026-11-06T10:00:00Z", text: "   " },
        ],
        updatedAt: "2026-11-05T10:00:00Z",
      },
      "BAD$": { thesis: "x" },
      EMPTY: { thesis: "   " },
      ARR: [],
    });
    expect(Object.keys(book)).toEqual(["NVDA"]);
    expect(book.NVDA).toMatchObject({ thesis: "AI capex cycle", conviction: 4, target: 240, stop: null, reviewBy: "2027-01-31", tags: ["ai", "semis"] });
    expect(book.NVDA.entries.map((e) => [e.text, e.kind, e.price])).toEqual([
      ["newer", "ai", null],
      ["older", "note", 180],
    ]);
  });

  it("rejects non-objects and bad conviction or review dates", () => {
    expect(sanitizeNotes(null)).toEqual({});
    expect(sanitizeNotes([1])).toEqual({});
    const book = sanitizeNotes({ AAPL: { thesis: "t", conviction: 9, reviewBy: "Jan 5" } });
    expect(book.AAPL).toMatchObject({ conviction: null, reviewBy: null });
  });
});

describe("note updates", () => {
  it("creates, edits and removes a note, dropping it when it becomes empty", () => {
    updateNote("MSFT", { thesis: "Cloud margins", target: 600 }, NOW);
    expect(notesStore.getSnapshot().MSFT).toMatchObject({ thesis: "Cloud margins", target: 600, updatedAt: NOW.toISOString() });
    updateNote("MSFT", { thesis: "", target: null }, NOW);
    expect(notesStore.getSnapshot().MSFT).toBeUndefined();
  });

  it("adds entries newest first, capped, and removes them by time stamp", () => {
    for (let i = 0; i < MAX_ENTRIES + 3; i++) addNoteEntry("AMD", { text: `entry ${i}`, price: 100 + i }, new Date(NOW.getTime() + i * 1000));
    const note = notesStore.getSnapshot().AMD;
    expect(note.entries).toHaveLength(MAX_ENTRIES);
    expect(note.entries[0].text).toBe(`entry ${MAX_ENTRIES + 2}`);
    addNoteEntry("AMD", { text: "   ", price: 1 }, NOW);
    expect(notesStore.getSnapshot().AMD.entries).toHaveLength(MAX_ENTRIES);
    removeNoteEntry("AMD", note.entries[0].at, NOW);
    expect(notesStore.getSnapshot().AMD.entries[0].text).toBe(`entry ${MAX_ENTRIES + 1}`);
    removeNote("AMD");
    expect(notesStore.getSnapshot().AMD).toBeUndefined();
  });

  it("persists to the notes key", () => {
    addNoteEntry("KO", { text: "dividend steady", price: 95, kind: "ai" }, NOW);
    expect(JSON.parse(storage.getItem("investseek:notes:v1") ?? "{}").KO.entries[0]).toMatchObject({ kind: "ai", price: 95 });
  });

  it("recognizes an empty note", () => {
    expect(isEmptyNote(emptyNote(NOW))).toBe(true);
    expect(isEmptyNote({ ...emptyNote(NOW), tags: ["x"] })).toBe(false);
  });
});
