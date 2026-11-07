import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A fake SDK: no real client is ever constructed and nothing reaches the network.
const sdk = vi.hoisted(() => {
  class APIError extends Error {
    constructor(
      public readonly status: number | undefined,
      message: string,
    ) {
      super(message);
      this.name = "APIError";
    }
  }
  const create = vi.fn();
  const constructed: Array<Record<string, unknown>> = [];
  class FakeOpenAI {
    chat = { completions: { create } };
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
    }
  }
  return { APIError, create, constructed, FakeOpenAI };
});

vi.mock("openai", () => ({ default: sdk.FakeOpenAI, APIError: sdk.APIError }));

import { AI_STREAM_ERROR, AI_STREAM_TRUNCATED } from "@/types/api";

import {
  aiTextResponse,
  AiNotConfiguredError,
  generationLimits,
  getModel,
  incompleteCompletionCode,
  isAiConfigured,
  isReasoningModel,
  streamChat,
  streamErrorCode,
  type LlmMessage,
} from "./deepseek";

const MESSAGES: LlmMessage[] = [
  { role: "system", content: "rules" },
  { role: "user", content: "question" },
];

interface Chunk {
  choices: Array<{ delta: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function chunk(content: string): Chunk {
  return { choices: [{ delta: { content } }] };
}

/** An async iterable of chunks that optionally fails after yielding them. */
function completion(chunks: Chunk[], failWith?: Error): AsyncIterable<Chunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of chunks) yield item;
      if (failWith) throw failWith;
    },
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

let keyCounter = 0;

describe("deepseek client", () => {
  beforeEach(() => {
    sdk.create.mockReset();
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-must-never-be-used");
    vi.stubEnv("DEEPSEEK_MODEL", "");
    // A new key per test forces a fresh client, so constructor options can be asserted.
    keyCounter += 1;
    vi.stubEnv("DEEPSEEK_API_KEY", `sk-deepseek-test-${keyCounter}`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is not configured without DEEPSEEK_API_KEY and never falls back to OPENAI_API_KEY", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "  ");
    const before = sdk.constructed.length;
    expect(isAiConfigured()).toBe(false);
    expect(() => streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 })).toThrow(AiNotConfiguredError);
    expect(sdk.constructed.length).toBe(before);
  });

  it("creates the client lazily with explicit options", async () => {
    sdk.create.mockResolvedValue(completion([chunk("ok")]));
    expect(isAiConfigured()).toBe(true);
    await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
    expect(sdk.constructed.at(-1)).toEqual({
      apiKey: `sk-deepseek-test-${keyCounter}`,
      baseURL: "https://api.deepseek.com",
      timeout: 60_000,
      maxRetries: 1,
      adminAPIKey: null,
      organization: null,
      project: null,
      webhookSecret: null,
      logLevel: "warn",
    });
  });

  it("uses DEEPSEEK_BASE_URL only over https or on localhost", async () => {
    sdk.create.mockResolvedValue(completion([chunk("ok")]));
    vi.stubEnv("DEEPSEEK_BASE_URL", "http://127.0.0.1:4010/v1");
    await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
    expect(sdk.constructed.at(-1)).toMatchObject({ baseURL: "http://127.0.0.1:4010/v1" });

    // Same key, new URL: a fresh client, never the old one pointed somewhere else.
    vi.stubEnv("DEEPSEEK_BASE_URL", "http://llm.example.com/v1");
    await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
    expect(sdk.constructed.at(-1)).toMatchObject({ baseURL: "https://api.deepseek.com" });
  });

  it("logs token usage as one structured line", async () => {
    sdk.create.mockResolvedValue(completion([chunk("ok"), { choices: [], usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } }]));
    await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
    const line = JSON.parse(String(vi.mocked(console.info).mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "info", event: "ai.usage", model: "deepseek-chat", promptTokens: 100, completionTokens: 2 });
  });

  it("reads the model from DEEPSEEK_MODEL with a safe default", () => {
    expect(getModel()).toBe("deepseek-chat");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-reasoner");
    expect(getModel()).toBe("deepseek-reasoner");
    vi.stubEnv("DEEPSEEK_MODEL", "bad model; rm -rf");
    expect(getModel()).toBe("deepseek-chat");
  });

  it("streams text deltas with the requested limits", async () => {
    sdk.create.mockResolvedValue(
      completion([
        chunk("## Bottom"),
        { choices: [{ delta: { content: null } }] },
        chunk(" line"),
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } },
      ]),
    );
    const text = await readAll(streamChat({ messages: MESSAGES, maxTokens: 1100, temperature: 0.3 }));
    expect(text).toBe("## Bottom line");
    const [params, options] = sdk.create.mock.calls[0] as [Record<string, unknown>, { signal: AbortSignal }];
    expect(params).toMatchObject({ model: "deepseek-chat", messages: MESSAGES, max_tokens: 1100, temperature: 0.3, stream: true });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it("ends with the error marker when the stream fails midway", async () => {
    sdk.create.mockResolvedValue(completion([chunk("partial")], new Error("socket hang up")));
    const text = await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
    expect(text).toBe(`partial${AI_STREAM_ERROR}upstream_error`);
  });

  it("ends with the error marker when the completion has no text or the provider cuts it off", async () => {
    const run = () => readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
    sdk.create.mockResolvedValueOnce(completion([{ choices: [{ delta: { content: "" }, finish_reason: "stop" }] }]));
    expect(await run()).toBe(`${AI_STREAM_ERROR}upstream_error`);
    sdk.create.mockResolvedValueOnce(completion([chunk("partial"), { choices: [{ delta: {}, finish_reason: "insufficient_system_resource" }] }]));
    expect(await run()).toBe(`partial${AI_STREAM_ERROR}upstream_error`);
    sdk.create.mockResolvedValueOnce(completion([chunk("cut"), { choices: [{ delta: {}, finish_reason: "content_filter" }] }]));
    expect(await run()).toBe(`cut${AI_STREAM_ERROR}upstream_error`);
  });

  it("treats normal endings as complete and flags length-limited ones", async () => {
    const run = () => readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
    sdk.create.mockResolvedValueOnce(completion([chunk("done"), { choices: [{ delta: {}, finish_reason: "stop" }] }]));
    expect(await run()).toBe("done");
    sdk.create.mockResolvedValueOnce(completion([chunk("long"), { choices: [{ delta: {}, finish_reason: "length" }] }]));
    expect(await run()).toBe(`long${AI_STREAM_TRUNCATED}`);
    expect(incompleteCompletionCode(true, null)).toBeNull();
    expect(incompleteCompletionCode(false, "stop")).toBe("upstream_error");
  });

  it("maps upstream failures to error codes", async () => {
    sdk.create.mockRejectedValueOnce(new sdk.APIError(429, "rate limited"));
    expect(await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }))).toBe(`${AI_STREAM_ERROR}rate_limited`);
    sdk.create.mockRejectedValueOnce(new sdk.APIError(402, "Insufficient Balance"));
    expect(await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }))).toBe(`${AI_STREAM_ERROR}ai_unavailable`);
    expect(streamErrorCode(new sdk.APIError(401, "bad key"))).toBe("ai_unavailable");
    expect(streamErrorCode(new sdk.APIError(500, "oops"))).toBe("upstream_error");
    expect(streamErrorCode(new Error("network"))).toBe("upstream_error");
  });

  it("never logs message contents", async () => {
    sdk.create.mockRejectedValueOnce(new sdk.APIError(500, "server error"));
    await readAll(streamChat({ messages: [{ role: "user", content: "my secret portfolio" }], maxTokens: 10, temperature: 0 }));
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("my secret portfolio");
  });

  it("aborts the upstream request when the reader cancels", async () => {
    let upstreamSignal: AbortSignal | undefined;
    sdk.create.mockImplementation(async (_params: unknown, options: { signal: AbortSignal }) => {
      upstreamSignal = options.signal;
      return completion([chunk("a"), chunk("b"), chunk("c")]);
    });
    const reader = streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }).getReader();
    await reader.read();
    expect(upstreamSignal?.aborted).toBe(false);
    await reader.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("aborts the upstream request when the caller signal aborts", async () => {
    let upstreamSignal: AbortSignal | undefined;
    sdk.create.mockImplementation(async (_params: unknown, options: { signal: AbortSignal }) => {
      upstreamSignal = options.signal;
      return completion([chunk("a")]);
    });
    const caller = new AbortController();
    const reader = streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0, signal: caller.signal }).getReader();
    await reader.read();
    caller.abort();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  /** Like the SDK's stream: yields `first`, then ends quietly (without throwing) once the request is aborted. */
  function quietOnAbort(first: string) {
    return async (_params: unknown, options: { signal: AbortSignal }) => ({
      async *[Symbol.asyncIterator]() {
        yield chunk(first);
        await new Promise<void>((resolve) => {
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    });
  }

  it("ends with the error marker when the generation deadline aborts a stream mid-way", async () => {
    vi.useFakeTimers();
    try {
      sdk.create.mockImplementation(quietOnAbort("partial"));
      const pending = readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await pending).toBe(`partial${AI_STREAM_ERROR}upstream_error`);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"event":"ai.deadline_exceeded"'));
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when the caller aborts a stream mid-way", async () => {
    sdk.create.mockImplementation(quietOnAbort("partial"));
    const caller = new AbortController();
    const reader = streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0, signal: caller.signal }).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("partial");
    caller.abort();
    expect((await reader.read()).done).toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("recognizes reasoning models and raises their limits", () => {
    for (const model of ["deepseek-reasoner", "deepseek-r1", "DeepSeek-R1-0528", "qwq-thinking"]) expect(isReasoningModel(model)).toBe(true);
    for (const model of ["deepseek-chat", "deepseek-v3", "gpt-4o", "r100"]) expect(isReasoningModel(model)).toBe(false);
    expect(generationLimits("deepseek-chat", 800)).toEqual({ maxTokens: 800, deadlineMs: 120_000, sendTemperature: true });
    expect(generationLimits("deepseek-reasoner", 800)).toEqual({ maxTokens: 8_192, deadlineMs: 240_000, sendTemperature: false });
    expect(generationLimits("deepseek-reasoner", 1400)).toMatchObject({ maxTokens: 8_400 });
    expect(generationLimits("deepseek-reasoner", 4000)).toMatchObject({ maxTokens: 16_384 });
  });

  it("sends a reasoning model the raised token limit and no temperature, and never streams its reasoning", async () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-reasoner");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.create.mockResolvedValue(completion([{ choices: [{ delta: { reasoning_content: "private thoughts" } }] }, chunk("## Bottom line")]));
    const text = await readAll(streamChat({ messages: MESSAGES, maxTokens: 1400, temperature: 0.3 }));
    expect(text).toBe("## Bottom line");
    const [params] = sdk.create.mock.calls[0] as [Record<string, unknown>];
    expect(params).toMatchObject({ model: "deepseek-reasoner", max_tokens: 8_400 });
    expect(params).not.toHaveProperty("temperature");
  });

  it("says model_limit when a model reasons until the token limit without answering", async () => {
    sdk.create.mockResolvedValueOnce(
      completion([{ choices: [{ delta: { reasoning_content: "thinking" } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }]),
    );
    expect(await readAll(streamChat({ messages: MESSAGES, maxTokens: 10, temperature: 0 }))).toBe(`${AI_STREAM_ERROR}model_limit`);
    expect(incompleteCompletionCode(false, "length", true)).toBe("model_limit");
    expect(incompleteCompletionCode(false, "length", false)).toBe("upstream_error");
    expect(incompleteCompletionCode(false, "stop", true)).toBe("upstream_error");
  });

  it("wraps streams in a non-cacheable text response", () => {
    const response = aiTextResponse(new ReadableStream());
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });
});
