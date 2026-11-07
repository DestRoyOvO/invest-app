import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BodyError, clientIp, readJsonBody } from "./http";

function jsonRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    // Required by undici for streamed request bodies.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function expectBodyError(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toBeInstanceOf(BodyError);
  await promise.catch((error: BodyError) => expect(error.status).toBe(status));
}

describe("readJsonBody", () => {
  it("parses a JSON body within the limit", async () => {
    await expect(readJsonBody(jsonRequest('{"a":1}'), 100)).resolves.toEqual({ a: 1 });
  });

  it("rejects a non-JSON content type with 415", async () => {
    await expectBodyError(readJsonBody(jsonRequest("{}", { "content-type": "text/plain" }), 100), 415);
  });

  it("rejects a declared length above the limit with 413", async () => {
    await expectBodyError(readJsonBody(jsonRequest("{}", { "content-length": "5000" }), 100), 413);
  });

  it("stops reading a streamed body without Content-Length once it exceeds the limit", async () => {
    const big = streamOf(['{"x":"', "a".repeat(80), "a".repeat(80), '"}']);
    await expectBodyError(readJsonBody(jsonRequest(big), 100), 413);
  });

  it("rejects malformed JSON with 400", async () => {
    await expectBodyError(readJsonBody(jsonRequest("{nope"), 100), 400);
  });
});

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  const withHeaders = (headers: Record<string, string>) => new Request("http://localhost/", { headers });

  it("ignores forwarded headers without a trusted proxy", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUST_PROXY", "");
    expect(clientIp(withHeaders({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" }))).toBe("direct");
  });

  it("uses the right-most hop behind a trusted reverse proxy", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUST_PROXY", "1");
    expect(clientIp(withHeaders({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("uses the platform header on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(withHeaders({ "x-real-ip": "192.0.2.44", "x-forwarded-for": "192.0.2.44" }))).toBe("192.0.2.44");
  });
});
