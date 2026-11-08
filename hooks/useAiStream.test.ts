import { beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";
import { AI_HEADERS, AI_STREAM_ERROR, AI_STREAM_TRUNCATED } from "@/types/api";

import { chatHistory, failureFromError, failureFromStreamCode, noteKey, noteMetaFromHeaders, readAiStream, retryBase, type ChatTurn } from "./useAiStream";

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

beforeAll(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

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
