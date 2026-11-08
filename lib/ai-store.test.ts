import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_CHATS_KEY,
  AI_NOTES_KEY,
  AI_PREFS_KEY,
  aiChatsStore,
  aiNotesStore,
  aiPrefsStore,
  clearChatHistory,
  conversationTitle,
  MAX_CHAT_MESSAGES,
  MAX_CONVERSATIONS,
  MAX_NOTE_KEY_CHARS,
  MAX_SAVED_NOTES,
  rememberNote,
  requestHash,
  restoreChatHistory,
  sanitizeAiPrefs,
  sanitizeChatHistory,
  sanitizeIntent,
  sanitizeSavedNotes,
  saveConversation,
  saveNote,
  setActiveConversation,
  setIncludePositions,
  upsertConversation,
  type Conversation,
  type SavedNote,
  type StoredChatMessage,
} from "./ai-store";

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

afterEach(() => vi.unstubAllGlobals());

function note(generatedAt: string, text = "## Bottom line"): SavedNote {
  return { text, truncated: false, generatedAt, dataAsOf: null, marketState: null, reused: false };
}

function message(role: "user" | "assistant", content: string, at = "2026-11-07T14:00:00.000Z"): StoredChatMessage {
  return { id: `${role}-${content}`, role, content, at, context: { key: "stock:NVDA", label: "NVDA" } };
}

function conversation(id: string, updatedAt: string, messages: StoredChatMessage[] = [message("user", `q ${id}`), message("assistant", "a")]): Conversation {
  return { id, title: `q ${id}`, createdAt: updatedAt, updatedAt, lang: "en", messages };
}

describe("AI settings", () => {
  it("include positions by default and keep the investor's choice", () => {
    expect(sanitizeAiPrefs(null)).toEqual({ includePositions: true });
    expect(sanitizeAiPrefs({ includePositions: "no" })).toEqual({ includePositions: true });
    expect(sanitizeAiPrefs({ includePositions: false })).toEqual({ includePositions: false });
    setIncludePositions(false);
    expect(JSON.parse(storage.getItem(AI_PREFS_KEY) ?? "{}")).toEqual({ includePositions: false });
    expect(aiPrefsStore.getSnapshot().includePositions).toBe(false);
  });
});

describe("saved notes", () => {
  it("keep the last note per request and only the 20 newest notes", () => {
    let notes = sanitizeSavedNotes({});
    for (let i = 0; i < 25; i++) notes = rememberNote(notes, `k${i}`, note(`2026-11-07T14:${String(i).padStart(2, "0")}:00.000Z`));
    expect(Object.keys(notes)).toHaveLength(MAX_SAVED_NOTES);
    expect(notes.k0).toBeUndefined();
    expect(notes.k24).toBeDefined();
    notes = rememberNote(notes, "k24", note("2026-11-07T15:00:00.000Z", "## Newer"));
    expect(notes.k24.text).toBe("## Newer");
    expect(Object.keys(notes)).toHaveLength(MAX_SAVED_NOTES);
  });

  it("hash long requests into short, stable keys", () => {
    const long = JSON.stringify({ kind: "watchlist", symbols: Array.from({ length: 50 }, (_, i) => `S${i}`) });
    expect(requestHash(long)).toBe(requestHash(long));
    expect(requestHash(long)).toMatch(/^[0-9a-z]{1,11}$/);
    expect(requestHash(long)).not.toBe(requestHash(long.replace("S49", "S50")));
    expect(requestHash("")).not.toBe(requestHash(" "));
  });

  it("accept the same keys when writing and when reading back", () => {
    const tooLong = "k".repeat(MAX_NOTE_KEY_CHARS + 1);
    expect(rememberNote({}, tooLong, note("2026-11-07T14:00:00.000Z"))).toEqual({});
    expect(sanitizeSavedNotes({ [tooLong]: note("2026-11-07T14:00:00.000Z") })).toEqual({});
    const longest = "k".repeat(MAX_NOTE_KEY_CHARS);
    expect(Object.keys(sanitizeSavedNotes(rememberNote({}, longest, note("2026-11-07T14:00:00.000Z"))))).toEqual([longest]);
  });

  it("drop invalid entries from storage", () => {
    const notes = sanitizeSavedNotes({ good: note("2026-11-07T14:00:00.000Z"), empty: { ...note("2026-11-07T14:00:00.000Z"), text: " " }, noDate: { text: "x" }, list: [] });
    expect(Object.keys(notes)).toEqual(["good"]);
    expect(sanitizeSavedNotes([1, 2])).toEqual({});
  });

  it("write through the store", () => {
    saveNote('{"kind":"market","lang":"en"}', { ...note("2026-11-07T14:00:00.000Z"), dataAsOf: "2026-11-06T21:00:00.000Z", marketState: "CLOSED", reused: true });
    expect(Object.keys(JSON.parse(storage.getItem(AI_NOTES_KEY) ?? "{}"))).toEqual(['{"kind":"market","lang":"en"}']);
    expect(aiNotesStore.getSnapshot()['{"kind":"market","lang":"en"}']).toMatchObject({ marketState: "CLOSED", reused: true });
  });
});

describe("chat history", () => {
  it("titles a conversation by its first question", () => {
    expect(conversationTitle([message("assistant", "hi"), message("user", "  Why is NVDA\nup today?  ")])).toBe("Why is NVDA up today?");
    expect(conversationTitle([message("user", "x".repeat(100))])).toHaveLength(80);
  });

  it("keeps 20 conversations of 20 messages, newest first, and makes the saved one active", () => {
    let history = sanitizeChatHistory({ conversations: [] });
    for (let i = 0; i < 25; i++) history = upsertConversation(history, conversation(`c${i}`, `2026-11-07T14:${String(i).padStart(2, "0")}:00.000Z`));
    expect(history.conversations).toHaveLength(MAX_CONVERSATIONS);
    expect(history.conversations[0].id).toBe("c24");
    expect(history.activeId).toBe("c24");
    const long = Array.from({ length: 30 }, (_, i) => message(i % 2 === 0 ? "user" : "assistant", `m${i}`));
    history = upsertConversation(history, conversation("c3", "2026-11-07T16:00:00.000Z", long));
    expect(history.conversations[0].id).toBe("c3");
    expect(history.conversations[0].messages).toHaveLength(MAX_CHAT_MESSAGES);
    expect(history.conversations[0].messages[0].content).toBe("m10");
  });

  it("sanitizes stored history, intents included", () => {
    const history = sanitizeChatHistory({
      activeId: "gone",
      conversations: [
        conversation("a", "2026-11-07T14:00:00.000Z", [{ ...message("user", "Why is it moving?"), intent: { kind: "move", symbol: "nvda" } } as StoredChatMessage, message("assistant", "Because.")]),
        { id: "empty", messages: [{ role: "system", content: "x" }] },
        conversation("a", "2026-11-07T13:00:00.000Z"),
        "junk",
      ],
    });
    expect(history.conversations.map((c) => c.id)).toEqual(["a"]);
    expect(history.activeId).toBeNull();
    expect(history.conversations[0].messages[0].intent).toEqual({ kind: "move", symbol: "NVDA" });
    expect(sanitizeIntent({ kind: "compare", symbols: ["nvda", "AMD", "bad symbol", "nvda"] })).toEqual({ kind: "compare", symbols: ["NVDA", "AMD"] });
    expect(sanitizeIntent({ kind: "compare", symbols: ["NVDA"] })).toBeUndefined();
    expect(sanitizeIntent({ kind: "earnings", symbol: "<x>" })).toBeUndefined();
    expect(sanitizeIntent({ kind: "portfolio" })).toBeUndefined();
  });

  it("saves, switches, clears and restores through the store", () => {
    saveConversation(conversation("a", "2026-11-07T14:00:00.000Z"));
    saveConversation(conversation("b", "2026-11-07T15:00:00.000Z"));
    expect(aiChatsStore.getSnapshot().activeId).toBe("b");
    setActiveConversation("a");
    expect(aiChatsStore.getSnapshot().activeId).toBe("a");
    setActiveConversation("missing");
    expect(aiChatsStore.getSnapshot().activeId).toBeNull();
    const before = clearChatHistory();
    expect(JSON.parse(storage.getItem(AI_CHATS_KEY) ?? "{}")).toEqual({ conversations: [], activeId: null });
    restoreChatHistory(before);
    expect(aiChatsStore.getSnapshot().conversations.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
