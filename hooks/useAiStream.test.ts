import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiChatsStore, aiNotesStore, MAX_NOTE_KEY_CHARS, rememberNote, sanitizeSavedNotes, type ChatHistory, type SavedNote } from "@/lib/ai-store";
import { ApiError } from "@/lib/api-client";
import { AI_HEADERS, AI_STREAM_ERROR, AI_STREAM_TRUNCATED, type AnalyzeRequest, type ChatIntentInput, type ChatRequest } from "@/types/api";

import {
  adoptShownChat,
  chatHistory,
  failureFromError,
  failureFromStreamCode,
  INITIAL_CHAT,
  isStaleConversation,
  noteKey,
  noteMetaFromHeaders,
  readAiStream,
  retryBase,
  shownChat,
  useAiChat,
  useAiNote,
  type ChatTurn,
} from "./useAiStream";

// React's act() needs this flag to flush effects and updates in tests.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => vi.unstubAllGlobals());

describe("readAiStream", () => {
  const signal = new AbortController().signal;

  it("returns the full text of a normal stream", async () => {
    const seen: string[] = [];
    const result = await readAiStream(streamOf(["## Bottom", " line\n\nText"]), (text) => seen.push(text), signal);
    expect(result).toEqual({ text: "## Bottom line\n\nText", truncated: false });
    expect(seen.at(-1)).toBe("## Bottom line\n\nText");
  });

  it("strips the truncation marker and reports it", async () => {
    const seen: string[] = [];
    const result = await readAiStream(streamOf(["Cut off mid", AI_STREAM_TRUNCATED]), (text) => seen.push(text), signal);
    expect(result).toEqual({ text: "Cut off mid", truncated: true });
    expect(seen.every((text) => !text.includes("[[AI_STREAM_"))).toBe(true);
  });

  it("throws the error code after the error marker and keeps the text before it", async () => {
    const seen: string[] = [];
    await expect(readAiStream(streamOf(["partial", `${AI_STREAM_ERROR}rate_limited`]), (text) => seen.push(text), signal)).rejects.toMatchObject({
      name: "AiStreamFailure",
      code: "rate_limited",
    });
    expect(seen.at(-1)).toBe("partial");
    expect(failureFromStreamCode("rate_limited")).toEqual({ kind: "rate_limited" });
    expect(failureFromStreamCode("upstream_error")).toEqual({ kind: "interrupted" });
  });
});

describe("failures", () => {
  it("names the reason of a failed request", () => {
    expect(failureFromError(new ApiError(401, "unauthorized", "Sign in to use the AI features."))).toEqual({ kind: "locked" });
    expect(failureFromError(new ApiError(403, "ai_unavailable", "AI is not configured on this server."))).toEqual({ kind: "not_configured" });
    expect(failureFromError(new ApiError(403, "ai_unavailable", "AI features are disabled on this deployment."))).toEqual({ kind: "unavailable" });
    expect(failureFromError(new ApiError(429, "rate_limited", "Too many AI requests. Please wait a moment and retry.", 42))).toEqual({ kind: "rate_limited", retryAfter: 42, daily: false });
    expect(failureFromError(new ApiError(429, "rate_limited", "The daily AI limit for this server has been reached.", 30_000))).toEqual({ kind: "rate_limited", retryAfter: 30_000, daily: true });
    expect(failureFromError(new Error("boom"))).toEqual({ kind: "failed" });
    expect(failureFromStreamCode("model_limit")).toEqual({ kind: "model_limit" });
    expect(failureFromStreamCode("ai_unavailable")).toEqual({ kind: "unavailable" });
  });
});

describe("notes", () => {
  it("keys a note by its request without the regenerate flag, independent of field order", () => {
    expect(noteKey({ kind: "stock", symbol: "NVDA", lang: "en", force: true })).toBe(noteKey({ lang: "en", symbol: "NVDA", kind: "stock" }));
    expect(noteKey({ kind: "stock", symbol: "NVDA", lang: "zh" })).not.toBe(noteKey({ kind: "stock", symbol: "NVDA", lang: "en" }));
    expect(noteKey({ kind: "watchlist", symbols: ["A"], lang: "en", positions: [{ symbol: "A", shares: 1, cost: 1 }] })).not.toBe(
      noteKey({ kind: "watchlist", symbols: ["A"], lang: "en" }),
    );
    expect(noteKey({ kind: "stock", symbol: "NVDA", lang: "en" })).toMatch(/^stock:NVDA:en:[0-9a-z]{1,11}$/);
    expect(noteKey({ kind: "sector", sector: "technology", lang: "zh" })).toMatch(/^sector:technology:zh:/);
  });

  it("keeps the key of the largest portfolio scan short, so its note survives a re-read", () => {
    const symbols = Array.from({ length: 50 }, (_, i) => `SYM${i}`);
    const positions = symbols.map((symbol, i) => ({ symbol, shares: 10 + i, cost: 100.25 + i }));
    const key = noteKey({ kind: "watchlist", symbols, positions, lang: "en" });
    expect(key.length).toBeLessThanOrEqual(MAX_NOTE_KEY_CHARS);
    expect(key.startsWith("watchlist::en:")).toBe(true);
    const moved = noteKey({ kind: "watchlist", symbols, positions: positions.map((p, i) => (i === 49 ? { ...p, shares: p.shares + 1 } : p)), lang: "en" });
    expect(moved).not.toBe(key);
    const note: SavedNote = { text: "## Bottom line", truncated: false, generatedAt: "2026-11-07T14:00:00.000Z", dataAsOf: null, marketState: null, reused: false };
    const saved = rememberNote({}, key, note);
    expect(Object.keys(sanitizeSavedNotes(JSON.parse(JSON.stringify(saved))))).toEqual([key]);
  });

  it("reads the data time, cache use and generation time from the response headers", () => {
    const headers = new Headers({
      [AI_HEADERS.dataAsOf]: "2026-11-06T21:00:00.000Z",
      [AI_HEADERS.marketState]: "CLOSED",
      [AI_HEADERS.noteCache]: "hit",
      [AI_HEADERS.generatedAt]: "2026-11-07T14:02:00.000Z",
    });
    expect(noteMetaFromHeaders(headers)).toEqual({ generatedAt: Date.parse("2026-11-07T14:02:00.000Z"), dataAsOf: "2026-11-06T21:00:00.000Z", marketState: "CLOSED", reused: true });
    expect(noteMetaFromHeaders(new Headers(), 123)).toEqual({ generatedAt: 123, dataAsOf: null, marketState: null, reused: false });
  });
});

describe("chat history sent to the server", () => {
  const turn = (role: "user" | "assistant", content: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({ id: content, role, content, at: "2026-11-07T14:00:00.000Z", context: null, ...extra });

  it("leaves out failed, streaming and empty turns and keeps the last ten", () => {
    const turns = [turn("user", "q1"), turn("assistant", "", { failure: { kind: "failed" } }), turn("user", "q2"), turn("assistant", "partial", { streaming: true })];
    expect(chatHistory(turns)).toEqual([
      { role: "user", content: "q1" },
      { role: "user", content: "q2" },
    ]);
    const long = Array.from({ length: 14 }, (_, i) => turn(i % 2 === 0 ? "user" : "assistant", `m${i}`));
    expect(chatHistory(long)).toHaveLength(10);
    expect(chatHistory(long)[0].content).toBe("m4");
  });
});

describe("retry", () => {
  const turn = (role: "user" | "assistant", content: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({ id: `${role}-${content}`, role, content, at: "2026-11-07T14:00:00.000Z", context: null, ...extra });

  it("asks the failed question again without its notice or the partial answer", () => {
    const failed = [turn("user", "q1"), turn("assistant", "a1"), turn("user", "q2"), turn("assistant", "", { failure: { kind: "failed" } })];
    expect(retryBase(failed)?.map((t) => t.content)).toEqual(["q1", "a1", "q2"]);
    const partial = [turn("user", "q1"), turn("assistant", "Partial answer"), turn("assistant", "", { failure: { kind: "model_limit" } })];
    expect(retryBase(partial)?.map((t) => t.content)).toEqual(["q1"]);
    expect(retryBase([turn("user", "q1"), turn("assistant", "a1")])).toBeNull();
    expect(retryBase([])).toBeNull();
  });
});

describe("chat state", () => {
  const at = (minutesAgo: number) => new Date(Date.parse("2026-11-07T16:00:00.000Z") - minutesAgo * 60_000).toISOString();
  const turn = (role: "user" | "assistant", content: string, minutesAgo: number): ChatTurn => ({ id: `${role}-${content}`, role, content, at: at(minutesAgo), context: null });
  const history: ChatHistory = {
    activeId: "c-1",
    conversations: [{ id: "c-1", title: "q", createdAt: at(30), updatedAt: at(29), lang: "en", messages: [turn("user", "q", 30), turn("assistant", "a", 29)] }],
  };

  it("shows the conversation open before a reload and adopts it, id included, on the first change", () => {
    expect(shownChat(INITIAL_CHAT, history)).toEqual({ turns: history.conversations[0].messages, conversationId: "c-1" });
    const working = adoptShownChat(INITIAL_CHAT, history);
    expect(working).toEqual({ turns: history.conversations[0].messages, conversationId: "c-1", touched: true });
    expect(adoptShownChat(working, { conversations: [], activeId: null })).toBe(working);
    expect(shownChat({ turns: [], conversationId: null, touched: true }, history)).toEqual({ turns: [], conversationId: null });
    expect(shownChat(INITIAL_CHAT, { conversations: [], activeId: null })).toEqual({ turns: [], conversationId: null });
  });

  it("calls a conversation stale three hours after its last message", () => {
    const now = Date.parse("2026-11-07T16:00:00.000Z");
    expect(isStaleConversation([], now)).toBe(false);
    expect(isStaleConversation([turn("user", "q", 200), turn("assistant", "a", 179)], now)).toBe(false);
    expect(isStaleConversation([turn("user", "q", 200), turn("assistant", "a", 181)], now)).toBe(true);
    expect(isStaleConversation([{ ...turn("user", "q", 0), at: "not a date" }], now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The hooks, rendered
// ---------------------------------------------------------------------------

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/**
 * The browser globals these hooks and React DOM use when a component renders nothing: localStorage for the stores and
 * a stand-in document without an active element for the commit phase of React DOM.
 */
function stubBrowser(): void {
  const noop = () => {};
  const document: Record<string, unknown> = { activeElement: null, body: null, addEventListener: noop, removeEventListener: noop };
  const window = { document, localStorage: new MemoryStorage(), HTMLIFrameElement: class {}, addEventListener: noop, removeEventListener: noop };
  document.defaultView = window;
  vi.stubGlobal("window", window);
}

interface Rendered<T> {
  readonly current: T;
  unmount(): Promise<void>;
}

/** Renders a probe component (it draws nothing and reports the latest value of its hook) into a stand-in container. */
async function render<T>(Probe: (props: { onRender: (value: T) => void }) => null): Promise<Rendered<T>> {
  let latest: T | undefined;
  const container = {
    nodeType: 1,
    nodeName: "DIV",
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: (globalThis as unknown as { window: { document: unknown } }).window.document,
    textContent: "",
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const root = createRoot(container as unknown as Element);
  const onRender = (value: T) => {
    latest = value;
  };
  await act(async () => root.render(createElement(Probe, { onRender })));
  return {
    get current() {
      return latest as T;
    },
    unmount: () => act(async () => root.unmount()),
  };
}

/** Lets streams, timers and state updates run until `done` holds. */
async function waitUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

const PAGE = { key: "market", label: "Market" };
const chatContext = (intent?: ChatIntentInput): ChatRequest["context"] => (intent ? { view: "market", intent } : { view: "market" });

function ChatProbe({ onRender }: { onRender: (chat: ReturnType<typeof useAiChat>) => void }) {
  onRender(useAiChat({ lang: "en", page: PAGE, buildContext: chatContext }));
  return null;
}

/** The conversation that was open before a reload, its last message `minutesAgo` old. */
function restoredHistory(minutesAgo: number): ChatHistory {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  return {
    activeId: "c-1",
    conversations: [
      {
        id: "c-1",
        title: "What moved the market today?",
        createdAt: at(minutesAgo + 1),
        updatedAt: at(minutesAgo),
        lang: "en",
        messages: [
          { id: "m-1", role: "user", content: "What moved the market today?", at: at(minutesAgo + 1), context: PAGE },
          { id: "m-2", role: "assistant", content: "Rates and earnings.", at: at(minutesAgo), context: PAGE },
        ],
      },
    ],
  };
}

describe("useAiChat", () => {
  let requests: ChatRequest[];

  beforeEach(() => {
    stubBrowser();
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)) as ChatRequest);
        return new Response(`Answer ${requests.length}`, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
      }),
    );
  });

  it("continues a conversation restored after a reload under its own id", async () => {
    aiChatsStore.write(restoredHistory(10));
    const chat = await render(ChatProbe);
    expect(chat.current.conversationId).toBe("c-1");
    expect(chat.current.turns).toHaveLength(2);
    await act(async () => chat.current.send("And bonds?"));
    await waitUntil(() => !chat.current.busy && chat.current.turns.length === 4);
    await act(async () => chat.current.send("And the dollar?"));
    await waitUntil(() => !chat.current.busy && chat.current.turns.length === 6);
    const saved = aiChatsStore.getSnapshot();
    expect(saved.conversations.map((c) => [c.id, c.messages.length])).toEqual([["c-1", 6]]);
    expect(saved.activeId).toBe("c-1");
    expect(chat.current.conversationId).toBe("c-1");
    expect(requests.map((request) => request.messages.length)).toEqual([3, 5]);
    await chat.unmount();
  });

  it("starts a new conversation for a seeded question when the one on screen is hours old", async () => {
    aiChatsStore.write(restoredHistory(26 * 60));
    const chat = await render(ChatProbe);
    const intent: ChatIntentInput = { kind: "move", symbol: "NVDA" };
    await act(async () => chat.current.send("Why is NVDA moving?", intent, { seeded: true }));
    await waitUntil(() => !chat.current.busy && chat.current.turns.length === 2);
    expect(requests[0].messages).toEqual([{ role: "user", content: "Why is NVDA moving?" }]);
    expect(requests[0].context.intent).toEqual(intent);
    const id = chat.current.conversationId;
    expect(id).not.toBe("c-1");
    expect(aiChatsStore.getSnapshot().conversations.map((c) => c.id)).toEqual([id, "c-1"]);
    // The new conversation is recent, so the next seeded question continues it.
    await act(async () => chat.current.send("Why is AMD moving?", { kind: "move", symbol: "AMD" }, { seeded: true }));
    await waitUntil(() => !chat.current.busy && chat.current.turns.length === 4);
    expect(aiChatsStore.getSnapshot().conversations.map((c) => [c.id, c.messages.length])).toEqual([
      [id, 4],
      ["c-1", 2],
    ]);
    await chat.unmount();
  });
});

const SCAN: AnalyzeRequest = {
  kind: "watchlist",
  lang: "en",
  symbols: Array.from({ length: 20 }, (_, i) => `SYM${i}`),
  positions: Array.from({ length: 10 }, (_, i) => ({ symbol: `SYM${i}`, shares: 10 + i, cost: 120.5 + i })),
};

function NoteProbe({ onRender }: { onRender: (note: ReturnType<typeof useAiNote>) => void }) {
  onRender(useAiNote(SCAN));
  return null;
}

describe("useAiNote", () => {
  const NOTE = "## Bottom line\n\nConcentrated in technology.";

  beforeEach(() => {
    stubBrowser();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(NOTE, { status: 200, headers: { [AI_HEADERS.generatedAt]: "2026-11-07T14:00:00.000Z", [AI_HEADERS.noteCache]: "miss" } })),
    );
  });

  it("shows the saved scan of a 20-symbol, 10-position portfolio again after a reload", async () => {
    const first = await render(NoteProbe);
    expect(first.current.status).toBe("idle");
    await act(async () => first.current.start());
    await waitUntil(() => first.current.status === "done");
    await first.unmount();
    // A reload: the store reads storage again, through its sanitizer, when the next page subscribes.
    const second = await render(NoteProbe);
    expect(second.current.status).toBe("done");
    expect(second.current.text).toBe(NOTE);
    expect(Object.keys(aiNotesStore.getSnapshot())).toEqual([noteKey(SCAN)]);
    await second.unmount();
  });
});
