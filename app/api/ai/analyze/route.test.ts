import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ streamChat: vi.fn(), buildAnalyzeContext: vi.fn() }));

vi.mock("@/lib/server/deepseek", () => ({
  AiNotConfiguredError: class AiNotConfiguredError extends Error {},
  isAiConfigured: () => true,
  streamChat: mocks.streamChat,
  aiTextResponse: (stream: ReadableStream<Uint8Array>) => new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }),
}));
vi.mock("@/lib/server/ai-context", () => ({ buildAnalyzeContext: mocks.buildAnalyzeContext }));

import { clearNoteCache } from "@/lib/server/note-cache";
import { checkDailyBudget, resetRateLimits } from "@/lib/server/rate-limit";
import { AI_HEADERS, AI_STREAM_ERROR } from "@/types/api";

import { POST } from "./route";

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function analyze(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost:3000/api/ai/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
    signal,
  });
}

const CONTEXT = {
  ok: true,
  text: "Stock: NVDA (NVIDIA Corporation).",
  subject: { en: "NVDA (NVIDIA Corporation)", zh: "NVDA（NVIDIA Corporation）" },
  asset: "equity",
  dataAsOf: "2026-11-06T21:00:00.000Z",
  marketState: "CLOSED",
};

const NOTE = { kind: "stock", symbol: "NVDA", lang: "en" };

beforeEach(() => {
  resetRateLimits();
  clearNoteCache();
  mocks.streamChat.mockReset();
  mocks.streamChat.mockImplementation(() => textStream("## Bottom line\nA note."));
  mocks.buildAnalyzeContext.mockReset();
  mocks.buildAnalyzeContext.mockResolvedValue(CONTEXT);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ACCESS_PASSWORD", "");
  vi.stubEnv("AI_DAILY_LIMIT", "5");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ai/analyze: note cache", () => {
  it("writes a note once and serves identical data from the cache without a model call", async () => {
    const first = await POST(analyze(NOTE));
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("## Bottom line\nA note.");
    expect(first.headers.get(AI_HEADERS.noteCache)).toBe("miss");
    expect(first.headers.get(AI_HEADERS.dataAsOf)).toBe("2026-11-06T21:00:00.000Z");
    expect(first.headers.get(AI_HEADERS.marketState)).toBe("CLOSED");
    expect(first.headers.get("cache-control")).toBe("no-store");
    const generatedAt = first.headers.get(AI_HEADERS.generatedAt);
    expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(checkDailyBudget()).toEqual({ ok: true, remaining: 4 });

    const second = await POST(analyze(NOTE));
    expect(await second.text()).toBe("## Bottom line\nA note.");
    expect(second.headers.get(AI_HEADERS.noteCache)).toBe("hit");
    expect(second.headers.get(AI_HEADERS.generatedAt)).toBe(generatedAt);
    expect(second.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(mocks.streamChat).toHaveBeenCalledTimes(1);
    expect(checkDailyBudget()).toEqual({ ok: true, remaining: 4 });
  });

  it("writes a new note for Regenerate (force) and for changed data or language", async () => {
    await (await POST(analyze(NOTE))).text();
    await (await POST(analyze({ ...NOTE, force: true }))).text();
    expect(mocks.streamChat).toHaveBeenCalledTimes(2);
    await (await POST(analyze({ ...NOTE, lang: "zh" }))).text();
    expect(mocks.streamChat).toHaveBeenCalledTimes(3);
    mocks.buildAnalyzeContext.mockResolvedValue({ ...CONTEXT, text: `${CONTEXT.text} New headline.` });
    await (await POST(analyze(NOTE))).text();
    expect(mocks.streamChat).toHaveBeenCalledTimes(4);
  });

  it("does not keep a failed note or one whose reader left", async () => {
    mocks.streamChat.mockImplementation(() => textStream(`partial${AI_STREAM_ERROR}upstream_error`));
    await (await POST(analyze(NOTE))).text();
    mocks.streamChat.mockImplementation(() => textStream("## Bottom line\nA note."));
    const left = new AbortController();
    const response = await POST(analyze(NOTE, left.signal));
    left.abort();
    await response.text();
    const third = await POST(analyze(NOTE));
    expect(third.headers.get(AI_HEADERS.noteCache)).toBe("miss");
    expect(mocks.streamChat).toHaveBeenCalledTimes(3);
  });

  it("picks the note structure from the asset class and sizes the move note", async () => {
    mocks.buildAnalyzeContext.mockResolvedValue({ ...CONTEXT, asset: "fund" });
    await (await POST(analyze(NOTE))).text();
    const fund = mocks.streamChat.mock.calls[0][0] as { messages: Array<{ content: string }>; maxTokens: number };
    expect(fund.messages[0].content).toContain("What it holds");
    mocks.buildAnalyzeContext.mockResolvedValue({ ...CONTEXT, subject: { en: "the latest move in NVDA", zh: "NVDA 的最新涨跌" } });
    await (await POST(analyze({ kind: "move", symbol: "NVDA", lang: "en" }))).text();
    const move = mocks.streamChat.mock.calls[1][0] as { messages: Array<{ content: string }>; maxTokens: number };
    expect(move.maxTokens).toBe(1000);
    expect(move.messages[0].content).toContain("Company-specific");
    expect(move.messages[2].content).toContain("the latest move in NVDA");
  });
});
