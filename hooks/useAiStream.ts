"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, postJson } from "@/lib/api-client";
import { AI_STREAM_ERROR, AI_STREAM_TRUNCATED, type AnalyzeRequest } from "@/types/api";

export type AiStatus = "idle" | "streaming" | "done" | "error";

export interface AiFailure {
  kind: "locked" | "unavailable" | "not_configured" | "rate_limited" | "interrupted" | "failed";
  retryAfter?: number;
}

interface CachedNote {
  text: string;
  at: number;
  truncated: boolean;
}

/** Notes generated in this browser session, keyed by request, so returning to a page shows the last note. */
const noteCache = new Map<string, CachedNote>();

function cacheKey(request: AnalyzeRequest): string {
  return JSON.stringify(request);
}

export function failureFromError(error: unknown): AiFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "locked" };
    if (error.code === "ai_unavailable") return { kind: error.message.toLowerCase().includes("configur") ? "not_configured" : "unavailable" };
    if (error.status === 429) return { kind: "rate_limited", retryAfter: error.retryAfter };
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

/** Streams an AI research note for an AnalyzeRequest. Aborts the previous request on restart and on unmount. */
export function useAiNote(request: AnalyzeRequest | null) {
  const key = request ? cacheKey(request) : null;
  const cachedForKey = key ? noteCache.get(key) : undefined;

  const [state, setState] = useState<{
    key: string | null;
    text: string;
    status: AiStatus;
    failure: AiFailure | null;
    at: number | null;
    truncated: boolean;
  }>(() => ({
    key,
    text: cachedForKey?.text ?? "",
    status: cachedForKey ? "done" : "idle",
    failure: null,
    at: cachedForKey?.at ?? null,
    truncated: cachedForKey?.truncated ?? false,
  }));
  const controllerRef = useRef<AbortController | null>(null);

  // When the request changes (another ticker or page), abort the old stream and show the cached note if any.
  if (state.key !== key) {
    const cached = key ? noteCache.get(key) : undefined;
    setState({ key, text: cached?.text ?? "", status: cached ? "done" : "idle", failure: null, at: cached?.at ?? null, truncated: cached?.truncated ?? false });
  }

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, [key]);

  const start = useCallback(async () => {
    if (!request || !key) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ key, text: "", status: "streaming", failure: null, at: null, truncated: false });
    try {
      const res = await postJson("/api/ai/analyze", request, controller.signal);
      const { text, truncated } = await readAiStream(
        res,
        (partial) => {
          if (!controller.signal.aborted) setState((s) => (s.key === key ? { ...s, text: partial } : s));
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const at = Date.now();
      noteCache.set(key, { text, at, truncated });
      setState((s) => (s.key === key ? { ...s, text, status: "done", at, truncated } : s));
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      const failure: AiFailure = error instanceof AiStreamFailure ? failureFromStreamCode(error.code) : failureFromError(error);
      setState((s) => (s.key === key ? { ...s, status: "error", failure } : s));
    }
  }, [request, key]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setState((s) => ({ ...s, status: s.text ? "done" : "idle" }));
  }, []);

  return { text: state.text, status: state.status, failure: state.failure, generatedAt: state.at, truncated: state.truncated, start, stop };
}
