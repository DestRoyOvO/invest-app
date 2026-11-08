"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { useLocalStore } from "@/hooks/useLocalStore";
import {
  aiChatsStore,
  aiNotesStore,
  conversationTitle,
  newConversationId,
  saveConversation,
  saveNote,
  setActiveConversation,
  type ChatContextRef,
  type StoredChatMessage,
} from "@/lib/ai-store";
import { isDailyLimit } from "@/lib/ai-wait";
import { ApiError, postJson } from "@/lib/api-client";
import { AI_HEADERS, AI_STREAM_ERROR, AI_STREAM_TRUNCATED, type AnalyzeRequest, type ChatIntentInput, type ChatRequest, type Lang } from "@/types/api";

export type AiStatus = "idle" | "streaming" | "done" | "error";

export interface AiFailure {
  kind: "locked" | "unavailable" | "not_configured" | "rate_limited" | "model_limit" | "interrupted" | "failed";
  retryAfter?: number;
  /** The 429 came from the server's daily AI budget, which resets at midnight UTC. */
  daily?: boolean;
}

export function failureFromError(error: unknown): AiFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "locked" };
    if (error.code === "ai_unavailable") return { kind: error.message.toLowerCase().includes("configur") ? "not_configured" : "unavailable" };
    if (error.status === 429) return { kind: "rate_limited", retryAfter: error.retryAfter, daily: isDailyLimit(error.message) };
  }
  return { kind: "failed" };
}

/** The server ended the stream with AI_STREAM_ERROR followed by an error code. */
export class AiStreamFailure extends Error {
  constructor(public readonly code: string) {
    super("interrupted");
    this.name = "AiStreamFailure";
  }
}

/** Maps a stream-error code to what the user should see. */
export function failureFromStreamCode(code: string): AiFailure {
  if (code === "rate_limited") return { kind: "rate_limited" };
  if (code === "ai_unavailable") return { kind: "unavailable" };
  if (code === "model_limit") return { kind: "model_limit" };
  return { kind: "interrupted" };
}

/** Every stream marker starts with this prefix; partial updates hide a marker that is still arriving. */
const MARKER_PREFIX = "[[AI_STREAM_";

function visibleText(text: string): string {
  const at = text.indexOf(MARKER_PREFIX);
  return at >= 0 ? text.slice(0, at).trimEnd() : text;
}

export interface AiStreamResult {
  text: string;
  /** The model stopped at the token limit, so the answer may end mid-sentence. */
  truncated: boolean;
}

/**
 * Reads a text/plain AI stream, calling onText with the accumulated text.
 * Resolves with the final text and whether it was cut off at the token limit, or throws AiStreamFailure when the
 * server appended AI_STREAM_ERROR.
 */
export async function readAiStream(res: Response, onText: (text: string) => void, signal: AbortSignal): Promise<AiStreamResult> {
  if (!res.body) throw new Error("empty body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let frame = 0;
  const flush = () => {
    frame = 0;
    onText(visibleText(text));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!frame) frame = requestAnimationFrame(flush);
    }
    text += decoder.decode();
  } finally {
    if (frame) cancelAnimationFrame(frame);
    if (signal.aborted) reader.cancel().catch(() => {});
  }
  const markerAt = text.indexOf(AI_STREAM_ERROR);
  if (markerAt >= 0) {
    const code = text.slice(markerAt + AI_STREAM_ERROR.length).trim().split(/\s+/)[0] ?? "";
    onText(text.slice(0, markerAt).trimEnd());
    throw new AiStreamFailure(code);
  }
  const truncatedAt = text.lastIndexOf(AI_STREAM_TRUNCATED);
  const truncated = truncatedAt >= 0 && text.slice(truncatedAt + AI_STREAM_TRUNCATED.length).trim() === "";
  if (truncated) text = text.slice(0, truncatedAt).trimEnd();
  onText(text);
  return { text, truncated };
}

/** What the analyze route says about a note (AI_HEADERS). */
export interface NoteMeta {
  /** Epoch ms the note was written. */
  generatedAt: number | null;
  dataAsOf: string | null;
  marketState: string | null;
  /** The server reused an identical earlier note. */
  reused: boolean;
}

export function noteMetaFromHeaders(headers: Headers, now: number = Date.now()): NoteMeta {
  const generated = Date.parse(headers.get(AI_HEADERS.generatedAt) ?? "");
  return {
    generatedAt: Number.isFinite(generated) ? generated : now,
    dataAsOf: headers.get(AI_HEADERS.dataAsOf),
    marketState: headers.get(AI_HEADERS.marketState),
    reused: headers.get(AI_HEADERS.noteCache) === "hit",
  };
}

/** Key of a note request in the saved notes: the request without the regenerate flag. */
export function noteKey(request: AnalyzeRequest): string {
  const rest: Record<string, unknown> = { ...request };
  delete rest.force;
  return JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))));
}

interface NoteSession {
  key: string;
  text: string;
  status: "streaming" | "done" | "error";
  failure: AiFailure | null;
  truncated: boolean;
  meta: NoteMeta | null;
}

const EMPTY_META: NoteMeta = { generatedAt: null, dataAsOf: null, marketState: null, reused: false };

/**
 * Streams an AI research note for an AnalyzeRequest. The last note per request is kept in this browser (lib/ai-store.ts,
 * about 20 notes), so returning to a page, or reloading it, shows it without a new request. start(true) regenerates,
 * skipping the server's note cache. Aborts the previous request on restart and on unmount.
 */
export function useAiNote(request: AnalyzeRequest | null) {
  const key = request ? noteKey(request) : null;
  const saved = useLocalStore(aiNotesStore);
  const stored = key ? saved[key] : undefined;
  const [session, setSession] = useState<NoteSession | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const current = session && session.key === key ? session : null;

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, [key]);

  const start = useCallback(
    async (force = false) => {
      if (!request || !key) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setSession({ key, text: "", status: "streaming", failure: null, truncated: false, meta: null });
      try {
        const res = await postJson("/api/ai/analyze", force ? { ...request, force: true } : request, controller.signal);
        const meta = noteMetaFromHeaders(res.headers);
        const { text, truncated } = await readAiStream(
          res,
          (partial) => {
            if (!controller.signal.aborted) setSession((s) => (s?.key === key ? { ...s, text: partial } : s));
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        saveNote(key, {
          text,
          truncated,
          generatedAt: new Date(meta.generatedAt ?? Date.now()).toISOString(),
          dataAsOf: meta.dataAsOf,
          marketState: meta.marketState,
          reused: meta.reused,
        });
        setSession((s) => (s?.key === key ? { ...s, text, status: "done", truncated, meta } : s));
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        const failure: AiFailure = error instanceof AiStreamFailure ? failureFromStreamCode(error.code) : failureFromError(error);
        setSession((s) => (s?.key === key ? { ...s, status: "error", failure } : s));
      }
    },
    [request, key],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setSession((s) => (s ? { ...s, status: "done" } : s));
  }, []);

  // This session's note while it streams or after it ran; otherwise the saved note.
  const sessionText = current?.text ?? "";
  const text = current && (sessionText || current.status === "streaming") ? sessionText : (stored?.text ?? "");
  const fromSession = current !== null && sessionText !== "";
  const meta: NoteMeta = fromSession
    ? (current?.meta ?? EMPTY_META)
    : stored
      ? { generatedAt: Date.parse(stored.generatedAt), dataAsOf: stored.dataAsOf, marketState: stored.marketState, reused: stored.reused }
      : EMPTY_META;
  const status: AiStatus = current ? (current.status === "done" && !text ? "idle" : current.status) : stored ? "done" : "idle";
  return {
    text,
    status,
    failure: current?.failure ?? null,
    generatedAt: meta.generatedAt,
    dataAsOf: meta.dataAsOf,
    marketState: meta.marketState,
    reused: meta.reused,
    truncated: fromSession ? (current?.truncated ?? false) : (stored?.truncated ?? false),
    start,
    stop,
  };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatTurn extends StoredChatMessage {
  /** The answer is still streaming. */
  streaming?: boolean;
  /** The answer failed; shown with a Retry button and never sent back to the model. */
  failure?: AiFailure;
}

export interface UseAiChatOptions {
  lang: Lang;
  /** The open page, stamped on each question. */
  page: ChatContextRef;
  /** The request context for a question (positions as allowed, the intent of a seeded question). */
  buildContext: (intent?: ChatIntentInput) => ChatRequest["context"];
}

/** Messages kept and sent: the server keeps the last 10 anyway. */
const SENT_MESSAGES = 10;

function newMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * What Retry asks again: the conversation up to the failed question, without the failure notice and without the
 * partial answer the failed attempt left before its error. Null when the last turn is not a failure.
 */
export function retryBase(turns: readonly ChatTurn[]): ChatTurn[] | null {
  if (!turns[turns.length - 1]?.failure) return null;
  const base = turns.slice(0, -1).filter((turn) => !turn.failure);
  if (base[base.length - 1]?.role === "assistant") base.pop();
  return base[base.length - 1]?.role === "user" ? base : null;
}

/** The conversation to send: answered turns only, without failed or empty answers. */
export function chatHistory(turns: readonly ChatTurn[]): ChatRequest["messages"] {
  return turns
    .filter((turn) => !turn.failure && !turn.streaming && turn.content.trim())
    .slice(-SENT_MESSAGES)
    .map((turn) => ({ role: turn.role, content: turn.content }));
}

/**
 * The research chat: sending, Retry after a failure (the question is not repeated), Regenerate of the last answer,
 * Stop, and the conversation history kept in this browser (up to 20 conversations of 20 messages).
 */
export function useAiChat({ lang, page, buildContext }: UseAiChatOptions) {
  const history = useLocalStore(aiChatsStore);
  const [state, setState] = useState<{ turns: ChatTurn[]; conversationId: string | null; touched: boolean }>({ turns: [], conversationId: null, touched: false });
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Until the investor does something here, the drawer shows the conversation that was open before a reload.
  const active = state.touched ? undefined : history.conversations.find((conversation) => conversation.id === history.activeId);
  const turns: ChatTurn[] = active && state.turns.length === 0 ? active.messages : state.turns;
  const conversationId = active && state.conversationId === null ? active.id : state.conversationId;
  const setTurns = useCallback((next: ChatTurn[] | ((all: ChatTurn[]) => ChatTurn[])) => {
    setState((s) => ({ ...s, touched: true, turns: typeof next === "function" ? next(s.turns) : next }));
  }, []);
  const setConversationId = useCallback((id: string | null) => setState((s) => ({ ...s, touched: true, conversationId: id })), []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const persist = useCallback(
    (all: readonly ChatTurn[], id: string) => {
      const messages: StoredChatMessage[] = all
        .filter((turn) => !turn.failure && !turn.streaming && turn.content.trim())
        .map((turn) => {
          const stored: StoredChatMessage = { id: turn.id, role: turn.role, content: turn.content, at: turn.at, context: turn.context };
          if (turn.intent) stored.intent = turn.intent;
          if (turn.truncated) stored.truncated = true;
          return stored;
        });
      if (messages.length === 0) return;
      const existing = aiChatsStore.getSnapshot().conversations.find((conversation) => conversation.id === id);
      const now = new Date().toISOString();
      saveConversation({ id, title: existing?.title ?? conversationTitle(messages), createdAt: existing?.createdAt ?? messages[0].at, updatedAt: now, lang, messages });
    },
    [lang],
  );

  /** Streams an answer to `base` (whose last turn is the question) and appends it. */
  const run = useCallback(
    async (base: ChatTurn[]) => {
      const question = [...base].reverse().find((turn) => turn.role === "user");
      if (!question) return;
      const id = conversationId ?? newConversationId();
      if (!conversationId) setConversationId(id);
      const answer: ChatTurn = { id: newMessageId(), role: "assistant", content: "", at: new Date().toISOString(), context: question.context, streaming: true };
      setTurns([...base, answer]);
      setBusy(true);
      const controller = new AbortController();
      controllerRef.current = controller;
      const update = (patch: Partial<ChatTurn>) => setTurns((all) => all.map((turn) => (turn.id === answer.id ? { ...turn, ...patch } : turn)));
      try {
        const body: ChatRequest = { messages: chatHistory(base), lang, context: buildContext(question.intent) };
        const res = await postJson("/api/ai/chat", body, controller.signal);
        const { text, truncated } = await readAiStream(res, (partial) => update({ content: partial }), controller.signal);
        if (controller.signal.aborted) return;
        const done: ChatTurn = { ...answer, content: text, streaming: false, ...(truncated ? { truncated: true } : {}) };
        const all = [...base, done];
        setTurns(all);
        persist(all, id);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        const failure = error instanceof AiStreamFailure ? failureFromStreamCode(error.code) : failureFromError(error);
        // A partial answer before a stream error stays readable; the failure is a separate notice.
        setTurns((all) => {
          const partial = all.find((turn) => turn.id === answer.id)?.content.trim();
          const rest = all.filter((turn) => turn.id !== answer.id);
          const kept = partial ? [...rest, { ...answer, content: partial, streaming: false }] : rest;
          return [...kept, { id: newMessageId(), role: "assistant", content: "", at: new Date().toISOString(), context: question.context, failure }];
        });
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        setBusy(false);
      }
    },
    [buildContext, conversationId, lang, persist, setConversationId, setTurns],
  );

  const send = useCallback(
    (text: string, intent?: ChatIntentInput) => {
      const content = text.trim();
      if (!content || busy) return;
      const question: ChatTurn = { id: newMessageId(), role: "user", content: content.slice(0, 2_000), at: new Date().toISOString(), context: page };
      if (intent) question.intent = intent;
      void run([...turns.filter((turn) => !turn.failure), question]);
    },
    [busy, page, run, turns],
  );

  /** Asks the last question again after a failure, without repeating it in the conversation. */
  const retry = useCallback(() => {
    if (busy || !turns[turns.length - 1]?.failure) return;
    const base = retryBase(turns);
    if (base) void run(base);
  }, [busy, run, turns]);

  /** Replaces the last answer with a new one. */
  const regenerate = useCallback(() => {
    if (busy) return;
    const base = turns.filter((turn) => !turn.failure);
    if (base[base.length - 1]?.role !== "assistant") return;
    void run(base.slice(0, -1));
  }, [busy, run, turns]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setBusy(false);
    setTurns((all) => all.filter((turn) => !(turn.streaming && !turn.content)).map((turn) => (turn.streaming ? { ...turn, streaming: false } : turn)));
  }, [setTurns]);

  const newChat = useCallback(() => {
    controllerRef.current?.abort();
    setBusy(false);
    setState({ turns: [], conversationId: null, touched: true });
    setActiveConversation(null);
  }, []);

  const openConversation = useCallback(
    (id: string) => {
      const conversation = history.conversations.find((c) => c.id === id);
      if (!conversation) return;
      controllerRef.current?.abort();
      setBusy(false);
      setState({ turns: conversation.messages, conversationId: conversation.id, touched: true });
      setActiveConversation(conversation.id);
    },
    [history],
  );

  return { turns, busy, conversationId, conversations: history.conversations, send, retry, regenerate, stop, newChat, openConversation };
}

/**
 * Data another component already fetched for `key`, read from the SWR cache without starting a request (no fetch on
 * mount, focus or reconnect, no polling). Used for page-aware AI suggestions and the price saved with a note.
 */
export function useCachedData<T>(key: string | null): T | undefined {
  const { data } = useSWR<T>(key, {
    revalidateOnMount: false,
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
  });
  return data;
}
