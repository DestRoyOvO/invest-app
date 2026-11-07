import { beforeAll, describe, expect, it, vi } from "vitest";

import { AI_STREAM_ERROR, AI_STREAM_TRUNCATED } from "@/types/api";

import { failureFromStreamCode, readAiStream } from "./useAiStream";

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
