import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { streamChat, type LlmMessage } from "@/lib/server/deepseek";
import { AI_STREAM_ERROR, AI_STREAM_TRUNCATED } from "@/types/api";

import { answerFor, chunksOf, scenarioOf, startMockLlm, subjectOf } from "./mock-llm.mjs";

// The mock model behind the end-to-end suite, driven by the app's own DeepSeek client (lib/server/deepseek.ts and
// the openai SDK), so the scenarios the specs rely on are known to reach the app as intended.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = await startMockLlm({ host: "127.0.0.1", port: 0 });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => vi.unstubAllEnvs());

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function note(symbol: string, name: string): LlmMessage[] {
  return [
    { role: "system", content: "You are a research assistant." },
    { role: "system", content: `Live data.\n\nStock: ${symbol} (${name}); type EQUITY.` },
    { role: "user", content: `Write the note on ${symbol} (${name}) now, using the live data and the required sections.` },
  ];
}

function useMock(key = "test", path = "") {
  vi.stubEnv("DEEPSEEK_API_KEY", key);
  vi.stubEnv("DEEPSEEK_BASE_URL", `${baseUrl}${path}`);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
}

describe("scenario selection", () => {
  it("reads markers in the latest user message first, then anywhere in the prompt", () => {
    expect(scenarioOf(note("AAPL", "Apple Inc."), "test")).toBe("default");
    expect(scenarioOf(note("E2ELEN", "E2E Length Scenario Inc."), "test")).toBe("length");
    expect(scenarioOf([...note("E2EERR", "x"), { role: "user", content: "Tell me about E2ESLOW" }], "test")).toBe("slow");
    expect(scenarioOf(note("AAPL", "Apple Inc."), "rejected")).toBe("rejected");
    expect(scenarioOf([{ role: "user", content: "E2EKEY please" }], "test")).toBe("rejected");
    expect(scenarioOf([{ role: "user", content: "XE2ELEN is not a marker" }], "test")).toBe("default");
  });

  it("lets a chat follow-up after a failed answer succeed, unless the page's context names a scenario", () => {
    const context = { role: "system", content: "Stock: AAPL (Apple Inc.); type EQUITY." };
    const failed = [context, { role: "user", content: "E2EERR what happened?" }, { role: "assistant", content: "Partial answer" }];
    expect(scenarioOf(failed.slice(0, 2), "test")).toBe("error");
    expect(scenarioOf([...failed, { role: "user", content: "And the volume?" }], "test")).toBe("default");
    expect(scenarioOf([{ role: "system", content: "Stock: E2EERR (E2E Stream Error Scenario Inc.)" }, { role: "user", content: "And the volume?" }], "test")).toBe("error");
  });

  it("names the subject of a note or the stock of a chat", () => {
    expect(subjectOf(note("NVDA", "NVIDIA Corporation"))).toEqual({ subject: "NVDA (NVIDIA Corporation)", symbol: "NVDA", kind: "note" });
    expect(subjectOf([{ role: "system", content: "Stock: MSFT (Microsoft Corporation); type EQUITY." }, { role: "user", content: "What changed?" }])).toMatchObject({ symbol: "MSFT", kind: "chat" });
    expect(answerFor(note("NVDA", "NVIDIA Corporation"), "default")).toContain("NVDA");
    expect(chunksOf("one two three four five six seven", 3)).toEqual(["one two three ", "four five six ", "seven"]);
  });
});

describe("through the app's DeepSeek client", () => {
  it("streams a note that names the symbol", async () => {
    useMock();
    const text = await readAll(streamChat({ messages: note("AAPL", "Apple Inc."), maxTokens: 500, temperature: 0.3 }));
    expect(text).toContain("AAPL");
    expect(text).toContain("## Summary");
    expect(text).not.toContain("[[AI_STREAM_");
  });

  it("works with a /v1 base URL too", async () => {
    useMock("test", "/v1");
    expect(await readAll(streamChat({ messages: note("MSFT", "Microsoft Corporation"), maxTokens: 500, temperature: 0.3 }))).toContain("MSFT");
  });

  it("ends a truncated answer with the truncation marker", async () => {
    useMock();
    const text = await readAll(streamChat({ messages: note("E2ELEN", "E2E Length Scenario Inc."), maxTokens: 500, temperature: 0.3 }));
    expect(text.endsWith(AI_STREAM_TRUNCATED)).toBe(true);
  });

  it("reports an error in the middle of the stream", async () => {
    useMock();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const text = await readAll(streamChat({ messages: note("E2EERR", "E2E Stream Error Scenario Inc."), maxTokens: 500, temperature: 0.3 }));
    expect(text).toContain(`${AI_STREAM_ERROR}upstream_error`);
    expect(text.indexOf(AI_STREAM_ERROR)).toBeGreaterThan(0);
  });

  it("answers a rejected key with 401, which the app reports as provider_rejected", async () => {
    useMock("rejected");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const text = await readAll(streamChat({ messages: note("AAPL", "Apple Inc."), maxTokens: 500, temperature: 0.3 }));
    expect(text).toBe(`${AI_STREAM_ERROR}provider_rejected`);
  });

  it("streams slowly enough to stop, and ends the stream when the client goes away", async () => {
    useMock();
    const stats = async () => (await (await fetch(`${baseUrl}/stats`)).json()) as { started: Record<string, number>; cancelled: Record<string, number> };
    const before = await stats();
    const controller = new AbortController();
    const started = Date.now();
    const reader = streamChat({ messages: note("E2ESLOW", "E2E Slow Stream Scenario Inc."), maxTokens: 500, temperature: 0.3, signal: controller.signal }).getReader();
    await reader.read();
    await reader.read();
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    controller.abort();
    await reader.cancel();
    await vi.waitFor(async () => expect((await stats()).cancelled.slow ?? 0).toBe((before.cancelled.slow ?? 0) + 1), { timeout: 2000 });
    expect((await stats()).started.slow).toBe((before.started.slow ?? 0) + 1);
  });

  it("answers non-streaming requests and health checks", async () => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ model: "deepseek-chat", messages: note("E2ELEN", "x") }),
    });
    const body = (await response.json()) as { choices: Array<{ finish_reason: string; message: { content: string } }>; usage: { total_tokens: number } };
    expect(body.choices[0].finish_reason).toBe("length");
    expect(body.usage.total_tokens).toBeGreaterThan(0);
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
  });
});
