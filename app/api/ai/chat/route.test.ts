import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ streamChat: vi.fn(), buildChatContext: vi.fn() }));

vi.mock("@/lib/server/deepseek", () => ({
  AiNotConfiguredError: class AiNotConfiguredError extends Error {},
  isAiConfigured: () => true,
  streamChat: mocks.streamChat,
  aiTextResponse: (stream: ReadableStream<Uint8Array>) => new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } }),
}));
vi.mock("@/lib/server/ai-context", () => ({ buildChatContext: mocks.buildChatContext }));

import { resetRateLimits } from "@/lib/server/rate-limit";

import { POST } from "./route";

beforeEach(() => {
  resetRateLimits();
  mocks.streamChat.mockReset();
  mocks.streamChat.mockImplementation(
    () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("answer"));
          controller.close();
        },
      }),
  );
  mocks.buildChatContext.mockReset();
  mocks.buildChatContext.mockResolvedValue({ ok: true, text: "Move breakdown for NVDA", subject: { en: "x", zh: "x" } });
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ACCESS_PASSWORD", "");
  vi.stubEnv("AI_DAILY_LIMIT", "5");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ai/chat", () => {
  it("forwards the positions and the intent of a seeded question to the context builder", async () => {
    const request = new Request("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({
        lang: "en",
        context: { view: "watchlist", symbols: ["nvda"], positions: [{ symbol: "nvda", shares: 10, cost: 120 }], intent: { kind: "move", symbol: "nvda" } },
        messages: [{ role: "user", content: "Why is NVDA up 2.78% today?" }],
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("answer");
    expect(mocks.buildChatContext).toHaveBeenCalledWith({
      view: "watchlist",
      symbols: ["NVDA"],
      positions: [{ symbol: "NVDA", shares: 10, cost: 120 }],
      intent: { kind: "move", symbol: "NVDA" },
    });
    const options = mocks.streamChat.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(options.messages[1].content).toContain("Move breakdown for NVDA");
    expect(options.messages[1].content).toMatch(/Assembled at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z\.$/);
  });
});
