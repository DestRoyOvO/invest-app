import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatLogLine, isLogLevelEnabled, isSensitiveKey, log, logThrottled, resetLogThrottles, serializeError } from "./log";

const NOW = new Date("2026-11-07T15:00:00.000Z");

function parse(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

describe("formatLogLine", () => {
  it("writes one JSON object with ts, level, event and the fields", () => {
    const line = formatLogLine("info", "ai.usage", { model: "deepseek-chat", promptTokens: 1200, cached: true }, NOW);
    expect(line).not.toContain("\n");
    expect(parse(line)).toEqual({ ts: NOW.toISOString(), level: "info", event: "ai.usage", model: "deepseek-chat", promptTokens: 1200, cached: true });
  });

  it("redacts credentials, cookies and model input by key, at any depth", () => {
    const line = parse(
      formatLogLine(
        "warn",
        "test.redaction",
        {
          password: "hunter2",
          sessionSecret: "s3cret",
          deepseekApiKey: "sk-abcdefghijklmnopqrstuvwxyz",
          request: { headers: { cookie: "is_session=abc", authorization: "Bearer abcdefghijkl" }, messages: [{ content: "my portfolio" }] },
          prompt: "system prompt",
          promptTokens: 10,
        },
        NOW,
      ),
    );
    expect(line).toMatchObject({
      password: "[redacted]",
      sessionSecret: "[redacted]",
      deepseekApiKey: "[redacted]",
      prompt: "[redacted]",
      promptTokens: 10,
      request: { headers: { cookie: "[redacted]", authorization: "[redacted]" }, messages: "[redacted]" },
    });
    const text = JSON.stringify(line);
    for (const secret of ["hunter2", "s3cret", "abcdefghijklmnop", "is_session=abc", "my portfolio", "system prompt"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("masks keys and bearer tokens inside free text", () => {
    const line = parse(formatLogLine("error", "test.mask", { detail: "Incorrect API key provided: sk-proj-abcdef123456. Bearer abcdefghijklmnop" }, NOW));
    expect(line.detail).toBe("Incorrect API key provided: sk-***. Bearer ***");
  });

  it("serialises errors, with the stack only at error level", () => {
    const error = Object.assign(new Error("Too Many Requests", { cause: new Error("socket hang up") }), { name: "HTTPError", code: 429 });
    const warn = parse(formatLogLine("warn", "yahoo.failed", { error }, NOW));
    expect(warn.error).toEqual({ name: "HTTPError", message: "Too Many Requests", code: 429, cause: { name: "Error", message: "socket hang up" } });
    const fatal = parse(formatLogLine("error", "yahoo.failed", { error }, NOW));
    expect((fatal.error as Record<string, unknown>).stack).toEqual(expect.stringContaining("Too Many Requests"));
    expect(serializeError("plain text")).toBe("plain text");
    expect(serializeError(Object.assign(new Error("x"), { status: 402, digest: "123" }))).toMatchObject({ status: 402, digest: "123" });
  });

  it("survives values JSON cannot represent and bounds large ones", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const line = parse(
      formatLogLine(
        "info",
        "test.bounds",
        {
          circular,
          big: BigInt(10),
          nan: Number.NaN,
          when: new Date(0),
          fn: () => 1,
          long: "x".repeat(2_000),
          list: Array.from({ length: 30 }, (_, i) => i),
          deep: { a: { b: { c: { d: { e: 1 } } } } },
          ts: "caller-supplied",
        },
        NOW,
      ),
    );
    expect(line.circular).toEqual({ name: "loop", self: "[circular]" });
    expect(line.big).toBe("10");
    expect(line.nan).toBe("NaN");
    expect(line.when).toBe("1970-01-01T00:00:00.000Z");
    expect(line.fn).toBe("[function]");
    expect((line.long as string).length).toBeLessThanOrEqual(501);
    expect(line.list).toHaveLength(21);
    expect(line.deep).toEqual({ a: { b: { c: "[object]" } } });
    expect(line.ts).toBe(NOW.toISOString());
    expect(line._ts).toBe("caller-supplied");
  });
});

describe("isSensitiveKey", () => {
  it("matches key endings, so token counts stay visible", () => {
    for (const key of ["ACCESS_PASSWORD", "sessionToken", "xApiKey", "setCookie", "systemPrompt", "messages"]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    for (const key of ["promptTokens", "completionTokens", "message", "model", "status"]) expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("log", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends debug and info to stdout and warn and error to stderr", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    log("debug", "a.debug");
    log("info", "a.info");
    log("warn", "a.warn");
    log("error", "a.error");
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('"event":"a.debug"'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"event":"a.info"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"a.warn"'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"event":"a.error"'));
  });

  it("respects LOG_LEVEL", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("LOG_LEVEL", "warn");
    log("info", "hidden");
    log("warn", "shown");
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    vi.stubEnv("LOG_LEVEL", "silent");
    log("error", "hidden");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(isLogLevelEnabled("debug", "info")).toBe(false);
    expect(isLogLevelEnabled("error", "info")).toBe(true);
  });
});

describe("logThrottled", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLogThrottles();
  });

  it("writes one line per key and interval, and the next line says how many were dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = NOW.getTime();
    logThrottled("limit:client", 60_000, "warn", "auth.rate_limited", { scope: "client" }, t0);
    logThrottled("limit:client", 60_000, "warn", "auth.rate_limited", { scope: "client" }, t0 + 1_000);
    logThrottled("limit:client", 60_000, "warn", "auth.rate_limited", { scope: "client" }, t0 + 59_999);
    // Another key has its own interval.
    logThrottled("limit:server", 60_000, "warn", "auth.rate_limited", { scope: "server" }, t0 + 2_000);
    expect(warn).toHaveBeenCalledTimes(2);

    logThrottled("limit:client", 60_000, "warn", "auth.rate_limited", { scope: "client" }, t0 + 60_000);
    const lines = warn.mock.calls.map(([line]) => parse(String(line)));
    expect(lines).toHaveLength(3);
    expect(lines[0]).not.toHaveProperty("suppressed");
    expect(lines[1]).toMatchObject({ scope: "server" });
    expect(lines[2]).toMatchObject({ event: "auth.rate_limited", scope: "client", suppressed: 2 });
  });
});
