import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BodyError, cacheControlFor, clientIp, jsonOk, readJsonBody, upstreamError } from "./http";

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
    for (const value of ["1", "true", "yes"]) {
      vi.stubEnv("TRUST_PROXY", value);
      expect(clientIp(withHeaders({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }))).toBe("198.51.100.7");
    }
    vi.stubEnv("TRUST_PROXY", "maybe");
    expect(clientIp(withHeaders({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }))).toBe("direct");
  });

  it("uses the platform header on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(withHeaders({ "x-real-ip": "192.0.2.44", "x-forwarded-for": "192.0.2.44" }))).toBe("192.0.2.44");
  });
});

describe("cache headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets a shared cache keep public responses and never stores uncacheable ones", () => {
    expect(cacheControlFor(60, "public")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=240");
    expect(cacheControlFor(0, "public")).toBe("no-store");
    expect(cacheControlFor(undefined, "private")).toBe("no-store");
  });

  it("keeps responses out of shared caches on a private site", () => {
    expect(cacheControlFor(60, "private")).toBe("private, max-age=0");
    vi.stubEnv("SITE_ACCESS", "private");
    expect(jsonOk({ ok: true }, { cacheSeconds: 15 }).headers.get("cache-control")).toBe("private, max-age=0");
    vi.stubEnv("SITE_ACCESS", "public");
    expect(jsonOk({ ok: true }, { cacheSeconds: 15 }).headers.get("cache-control")).toContain("s-maxage=15");
  });
});

describe("upstreamError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs one structured line and hides the detail from the client", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = upstreamError("api/quotes", new Error("socket hang up"));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("socket");
    const line = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "error", event: "http.upstream_error", route: "api/quotes", error: { name: "Error", message: "socket hang up" } });
  });
});
