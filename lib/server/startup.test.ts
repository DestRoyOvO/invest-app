import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { register } from "@/instrumentation";

import { parseEnv } from "./env";
import { runStartupChecks, UnsafeConfigurationError } from "./startup";

const SECRET = "0123456789abcdef0123456789abcdef-test";
const PASSWORD = "correct horse battery staple";

function lines(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);
}

describe("runStartupChecks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("logs one startup line without secrets", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    runStartupChecks(parseEnv({ NODE_ENV: "production", DEEPSEEK_API_KEY: "sk-live-abcdefghijkl", ACCESS_PASSWORD: PASSWORD, SESSION_SECRET: SECRET }));
    const [line] = lines(info);
    expect(line).toMatchObject({ level: "info", event: "startup", authMode: "password", signIn: "ready", aiConfigured: true, dataSource: "yahoo" });
    expect(typeof line.version).toBe("string");
    const text = JSON.stringify(info.mock.calls);
    for (const secret of ["sk-live", PASSWORD, SECRET]) expect(text).not.toContain(secret);
  });

  it("refuses to start in production with a password but no usable secret", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => runStartupChecks(parseEnv({ NODE_ENV: "production", ACCESS_PASSWORD: PASSWORD, SESSION_SECRET: "short" }))).toThrow(
      UnsafeConfigurationError,
    );
    expect(lines(error)).toEqual([expect.objectContaining({ event: "config.issue", key: "SESSION_SECRET", level: "error" })]);
  });

  it("refuses to start a private site in production without a password", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => runStartupChecks(parseEnv({ NODE_ENV: "production", SITE_ACCESS: "private" }))).toThrow(/SITE_ACCESS=private/);
  });

  it("only warns in development, and about weak values in production", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => runStartupChecks(parseEnv({ NODE_ENV: "development", SITE_ACCESS: "private" }))).not.toThrow();
    expect(() => runStartupChecks(parseEnv({ NODE_ENV: "production", ACCESS_PASSWORD: "pw", SESSION_SECRET: SECRET, AI_DAILY_LIMIT: "lots" }))).not.toThrow();
    expect(lines(warn).map((line) => line.key)).toEqual(["AI_DAILY_LIMIT", "ACCESS_PASSWORD"]);
  });
});

describe("instrumentation register", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stops the process when the production configuration is unsafe", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ACCESS", "private");
    vi.stubEnv("ACCESS_PASSWORD", "");
    await expect(register()).rejects.toBeInstanceOf(UnsafeConfigurationError);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("skips the Edge runtime and next build, and checks the Node server", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(info).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await register();
    expect(lines(info)).toEqual([expect.objectContaining({ event: "startup" })]);
  });
});
