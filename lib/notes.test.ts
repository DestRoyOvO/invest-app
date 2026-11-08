import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addNoteEntry,
  compareByReview,
  emptyNote,
  isEmptyNote,
  isPlausibleReviewDate,
  levelDistance,
  MAX_ENTRIES,
  MAX_TAGS,
  mergeTags,
  normalizeTag,
  notesDueForReview,
  notesStore,
  removeNote,
  removeNoteEntry,
  restoreNote,
  restoreNoteEntry,
  reviewDaysLeft,
  reviewStatus,
  sanitizeNotes,
  tagCounts,
  thesisExcerpt,
  updateNote,
} from "./notes";

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

describe("undo helpers", () => {
  it("restores a removed entry in order and a removed note", () => {
    addNoteEntry("NVDA", { text: "first", price: 170 }, new Date("2026-11-01T10:00:00Z"));
    addNoteEntry("NVDA", { text: "second", price: 180 }, new Date("2026-11-03T10:00:00Z"));
    const [second, first] = notesStore.getSnapshot().NVDA.entries;
    removeNoteEntry("NVDA", first.at, NOW);
    restoreNoteEntry("NVDA", first, NOW);
    restoreNoteEntry("NVDA", first, NOW);
    expect(notesStore.getSnapshot().NVDA.entries.map((e) => e.text)).toEqual([second.text, "first"]);
    const note = notesStore.getSnapshot().NVDA;
    removeNote("NVDA");
    restoreNote("NVDA", note);
    expect(notesStore.getSnapshot().NVDA.entries).toHaveLength(2);
    restoreNote("EMPTY", emptyNote(NOW));
    expect(notesStore.getSnapshot().EMPTY).toBeUndefined();
  });
});

describe("tags", () => {
  it("normalizes case, spaces, commas and length", () => {
    expect(normalizeTag("  AI   Capex ")).toBe("ai capex");
    expect(normalizeTag("a,b")).toBe("a b");
    expect(normalizeTag("x".repeat(40))).toHaveLength(24);
    expect(normalizeTag("   ")).toBe("");
  });

  it("merges comma separated input without duplicates and caps the list", () => {
    expect(mergeTags(["ai"], "AI, semis，dividend , ")).toEqual(["ai", "semis", "dividend"]);
    expect(mergeTags([], Array.from({ length: 12 }, (_, i) => `t${i}`).join(","))).toHaveLength(MAX_TAGS);
  });

  it("counts tags across notes, most used first", () => {
    const book = sanitizeNotes({ A: { tags: ["ai", "semis"] }, B: { tags: ["AI"] }, C: { tags: ["value"] } });
    expect(tagCounts(book)).toEqual([
      { tag: "ai", count: 2 },
      { tag: "semis", count: 1 },
      { tag: "value", count: 1 },
    ]);
  });
});

describe("levels and review dates", () => {
  it("measures a level's distance from the price in percent", () => {
    expect(levelDistance(170, 186.64)).toBeCloseTo(-8.915, 2);
    expect(levelDistance(240, 186.64)).toBeCloseTo(28.59, 2);
    expect(levelDistance(null, 186.64)).toBeNull();
    expect(levelDistance(170, 0)).toBeNull();
  });

  it("counts calendar days to the review date in the local calendar", () => {
    const localNoon = new Date(2026, 10, 7, 12, 0);
    const lateEvening = new Date(2026, 10, 7, 23, 59);
    expect(reviewDaysLeft("2026-11-07", localNoon)).toBe(0);
    expect(reviewDaysLeft("2026-11-08", lateEvening)).toBe(1);
    expect(reviewDaysLeft("2026-11-04", localNoon)).toBe(-3);
    expect(reviewDaysLeft("2027-01-31", localNoon)).toBe(85);
    expect(reviewDaysLeft(null, localNoon)).toBeNull();
    expect(reviewDaysLeft("Jan 5", localNoon)).toBeNull();
  });

  it("accepts only whole, plausible review dates", () => {
    expect(isPlausibleReviewDate("2027-02-15")).toBe(true);
    expect(isPlausibleReviewDate("2100-12-31")).toBe(true);
    // What a date field reports while a year is typed digit by digit, and other half-typed or impossible values.
    for (const value of ["0001-02-15", "0012-02-15", "0123-02-15", "1231-02-15", "12312-02-15", "2101-01-01", "", "2027-2-15", "2027-02-30", "2027-13-01"]) {
      expect(isPlausibleReviewDate(value)).toBe(false);
    }
  });

  it("labels review states", () => {
    const now = new Date(2026, 10, 7, 9, 0);
    expect(reviewStatus("2026-11-01", now)).toBe("overdue");
    expect(reviewStatus("2026-11-07", now)).toBe("today");
    expect(reviewStatus("2026-11-14", now)).toBe("soon");
    expect(reviewStatus("2026-11-15", now)).toBe("later");
    expect(reviewStatus(null, now)).toBe("none");
  });

  it("lists notes due for review and orders by review date", () => {
    const now = new Date(2026, 10, 7, 9, 0);
    const book = sanitizeNotes({
      LATER: { thesis: "x", reviewBy: "2026-12-01" },
      NONE: { thesis: "x" },
      TODAY: { thesis: "x", reviewBy: "2026-11-07" },
      OLD: { thesis: "x", reviewBy: "2026-10-01" },
    });
    expect(notesDueForReview(book, now)).toEqual(["OLD", "TODAY"]);
    const order = Object.entries(book)
      .sort(([, a], [, b]) => compareByReview(a, b, now))
      .map(([symbol]) => symbol);
    expect(order).toEqual(["OLD", "TODAY", "LATER", "NONE"]);
  });
});

describe("thesisExcerpt", () => {
  it("keeps the first line and cuts long text on a word boundary", () => {
    expect(thesisExcerpt("\n  Data center demand\nsecond line")).toBe("Data center demand");
    const long = "Accelerated computing keeps taking share of data center capex while software lock-in deepens over time";
    const excerpt = thesisExcerpt(long, 60);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(excerpt.slice(0, -1))).toBe(true);
    expect(thesisExcerpt("", 10)).toBe("");
  });
});
