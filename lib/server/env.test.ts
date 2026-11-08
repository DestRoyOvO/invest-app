import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseLoginRequest } from "./ai-schemas";
import {
  authModeOf,
  DEFAULT_AI_DAILY_LIMIT,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  ENV_KEYS,
  isAllowedBaseUrl,
  isLoopbackHostname,
  MAX_ACCESS_PASSWORD_LENGTH,
  parseEnv,
  readEnv,
  startupSummary,
  type EnvIssue,
} from "./env";

const SECRET = "0123456789abcdef0123456789abcdef-test";
const PASSWORD = "correct horse battery staple";

function issuesFor(raw: Record<string, string>, key?: string): EnvIssue[] {
  return parseEnv(raw).issues.filter((issue) => key === undefined || issue.key === key);
}

describe("parseEnv defaults", () => {
  it("uses the documented defaults for an empty environment, without issues", () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      nodeEnv: "development",
      isProduction: false,
      onVercel: false,
      commit: null,
      deepseekApiKey: null,
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      accessPassword: null,
      sessionSecret: null,
      aiDailyLimit: DEFAULT_AI_DAILY_LIMIT,
      trustProxy: false,
      siteAccess: "public",
      siteUrl: null,
      logLevel: "info",
      marketDataSource: "yahoo",
    });
    expect(env.issues).toEqual([]);
  });

  it("treats blank values as unset, the way `KEY=` lines in .env.example are meant", () => {
    const blank = Object.fromEntries(ENV_KEYS.map((key) => [key, "  "]));
    const env = parseEnv(blank);
    expect(env.issues).toEqual([]);
    expect(env.deepseekModel).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(env.accessPassword).toBeNull();
  });

  it("reads the platform values", () => {
    const env = parseEnv({ NODE_ENV: "production", VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "ABCDEF1234567890" });
    expect(env).toMatchObject({ nodeEnv: "production", isProduction: true, onVercel: true, commit: "abcdef1234567890" });
    expect(parseEnv({ GIT_SHA: "0123abc" }).commit).toBe("0123abc");
    expect(parseEnv({ GIT_SHA: "not a sha" }).commit).toBeNull();
    expect(parseEnv({ NODE_ENV: "staging" }).nodeEnv).toBe("development");
  });
});

describe("parseEnv values", () => {
  it("accepts valid values", () => {
    const env = parseEnv({
      DEEPSEEK_API_KEY: " sk-test ",
      DEEPSEEK_MODEL: "deepseek-reasoner",
      DEEPSEEK_BASE_URL: "http://127.0.0.1:4010/v1",
      AI_DAILY_LIMIT: " 75 ",
      TRUST_PROXY: "TRUE",
      SITE_URL: "https://invest.example.com/some/path",
      LOG_LEVEL: "Debug",
    });
    expect(env).toMatchObject({
      deepseekApiKey: "sk-test",
      deepseekModel: "deepseek-reasoner",
      deepseekBaseUrl: "http://127.0.0.1:4010/v1",
      aiDailyLimit: 75,
      trustProxy: true,
      siteUrl: "https://invest.example.com",
      logLevel: "debug",
    });
    expect(env.issues).toEqual([]);
  });

  it("falls back to the default and reports invalid values", () => {
    const env = parseEnv({
      DEEPSEEK_MODEL: "bad model; rm -rf",
      AI_DAILY_LIMIT: "1e3",
      TRUST_PROXY: "maybe",
      LOG_LEVEL: "verbose",
      SITE_URL: "invest.example.com",
      MARKET_DATA_SOURCE: "bloomberg",
    });
    expect(env).toMatchObject({
      deepseekModel: DEFAULT_DEEPSEEK_MODEL,
      aiDailyLimit: DEFAULT_AI_DAILY_LIMIT,
      trustProxy: false,
      logLevel: "info",
      siteUrl: null,
      marketDataSource: "yahoo",
    });
    expect(env.issues.map((issue) => [issue.key, issue.level])).toEqual([
      ["DEEPSEEK_MODEL", "warn"],
      ["AI_DAILY_LIMIT", "warn"],
      ["TRUST_PROXY", "warn"],
      ["SITE_URL", "warn"],
      ["LOG_LEVEL", "warn"],
      ["MARKET_DATA_SOURCE", "warn"],
    ]);
    expect(env.issues[1].message).toContain('"1e3"');
  });

  it("keeps the old AI_DAILY_LIMIT rules", () => {
    for (const invalid of ["0", "-5", "abc", "12.5", "1e3", "12345678"]) {
      expect(parseEnv({ AI_DAILY_LIMIT: invalid }).aiDailyLimit).toBe(DEFAULT_AI_DAILY_LIMIT);
    }
    expect(parseEnv({ AI_DAILY_LIMIT: "9999999" }).aiDailyLimit).toBe(9_999_999);
  });

  it("accepts the usual spellings of a boolean flag", () => {
    for (const yes of ["1", "true", "yes", "on", "ON"]) expect(parseEnv({ TRUST_PROXY: yes }).trustProxy).toBe(true);
    for (const no of ["0", "false", "no", "off", ""]) expect(parseEnv({ TRUST_PROXY: no }).trustProxy).toBe(false);
  });

  it("never quotes secrets or URLs in issue messages", () => {
    const issues = issuesFor({
      DEEPSEEK_BASE_URL: "https://user:hunter2@api.example.com",
      SITE_URL: "ftp://token-abc@example.com",
      ACCESS_PASSWORD: "pw-qzx",
      SESSION_SECRET: "tiny-qzx-secret",
    });
    const text = JSON.stringify(issues);
    expect(issues.length).toBeGreaterThan(0);
    for (const secret of ["hunter2", "token-abc", "pw-qzx", "tiny-qzx"]) expect(text).not.toContain(secret);
  });

  it("serves fixture data on request, silently in development", () => {
    const env = parseEnv({ MARKET_DATA_SOURCE: " Fixtures " });
    expect(env.marketDataSource).toBe("fixtures");
    expect(env.issues).toEqual([]);
  });

  it("allows fixture data in production (the end-to-end suite runs a production build) but reports it", () => {
    const env = parseEnv({ NODE_ENV: "production", MARKET_DATA_SOURCE: "fixtures" });
    expect(env.marketDataSource).toBe("fixtures");
    expect(env.issues).toEqual([expect.objectContaining({ key: "MARKET_DATA_SOURCE", level: "warn" })]);
    expect(env.issues[0].message).toContain("synthetic");
  });

  it("no longer knows the reserved record mode", () => {
    const env = parseEnv({ MARKET_DATA_SOURCE: "record" });
    expect(env.marketDataSource).toBe("yahoo");
    expect(env.issues).toEqual([expect.objectContaining({ key: "MARKET_DATA_SOURCE", level: "warn" })]);
    expect(env.issues[0].message).toContain('"record"');
  });
});

describe("DEEPSEEK_BASE_URL", () => {
  it("allows https anywhere and plain http only on loopback hosts", () => {
    for (const ok of ["https://api.deepseek.com", "https://llm.example.com/v1/", "http://localhost:4010", "http://127.0.0.1:4010/v1", "http://[::1]:8080"]) {
      expect(isAllowedBaseUrl(ok)).toBe(true);
    }
    for (const bad of [
      "http://api.deepseek.com",
      "http://192.168.1.20:4010",
      "http://127.0.0.1.evil.example",
      "http://app.localhost:4010",
      "https://user:pass@api.example.com",
      "https://api.example.com/?key=1",
      "https://api.example.com/#x",
      "ftp://api.example.com",
      "api.deepseek.com",
    ]) {
      expect(isAllowedBaseUrl(bad)).toBe(false);
    }
  });

  it("falls back to the official endpoint for a disallowed URL", () => {
    const env = parseEnv({ DEEPSEEK_BASE_URL: "http://llm.example.com" });
    expect(env.deepseekBaseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL);
    expect(env.issues).toEqual([expect.objectContaining({ key: "DEEPSEEK_BASE_URL", level: "warn" })]);
  });

  it("recognises loopback host names", () => {
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("127.255.0.1")).toBe(true);
    expect(isLoopbackHostname("127.0.0.256")).toBe(false);
    expect(isLoopbackHostname("128.0.0.1")).toBe(false);
  });
});

describe("password, secret and private mode", () => {
  it("keeps the password exactly as written and accepts a long secret", () => {
    const env = parseEnv({ ACCESS_PASSWORD: ` ${PASSWORD} `, SESSION_SECRET: SECRET });
    expect(env.accessPassword).toBe(` ${PASSWORD} `);
    expect(env.sessionSecret).toBe(SECRET);
    expect(env.issues).toEqual([]);
  });

  it("is an error to set a password without a usable secret", () => {
    expect(issuesFor({ ACCESS_PASSWORD: PASSWORD }, "SESSION_SECRET")).toEqual([expect.objectContaining({ level: "error" })]);
    const short = parseEnv({ ACCESS_PASSWORD: PASSWORD, SESSION_SECRET: "too-short" });
    expect(short.sessionSecret).toBeNull();
    expect(short.issues).toEqual([expect.objectContaining({ key: "SESSION_SECRET", level: "error" })]);
  });

  it("is an error to set a password longer than the sign-in form accepts", () => {
    const tooLong = "x".repeat(MAX_ACCESS_PASSWORD_LENGTH + 1);
    expect(issuesFor({ ACCESS_PASSWORD: tooLong, SESSION_SECRET: SECRET })).toEqual([expect.objectContaining({ key: "ACCESS_PASSWORD", level: "error" })]);
    expect(issuesFor({ ACCESS_PASSWORD: "x".repeat(MAX_ACCESS_PASSWORD_LENGTH), SESSION_SECRET: SECRET })).toEqual([]);
    // The limit is the login schema's own, so a password that passes startup can always be typed in.
    expect(parseLoginRequest({ password: "x".repeat(MAX_ACCESS_PASSWORD_LENGTH) }).ok).toBe(true);
    expect(parseLoginRequest({ password: tooLong }).ok).toBe(false);
  });

  it("warns about a weak password and an unused secret", () => {
    expect(issuesFor({ ACCESS_PASSWORD: "pw", SESSION_SECRET: SECRET })).toEqual([expect.objectContaining({ key: "ACCESS_PASSWORD", level: "warn" })]);
    expect(issuesFor({ SESSION_SECRET: SECRET })).toEqual([expect.objectContaining({ key: "SESSION_SECRET", level: "warn" })]);
  });

  it("warns when AI is configured but stays off in production", () => {
    expect(issuesFor({ NODE_ENV: "production", DEEPSEEK_API_KEY: "sk-test" })).toEqual([
      expect.objectContaining({ key: "ACCESS_PASSWORD", level: "warn" }),
    ]);
    expect(issuesFor({ NODE_ENV: "development", DEEPSEEK_API_KEY: "sk-test" })).toEqual([]);
  });

  it("requires a password and a secret for private mode", () => {
    expect(issuesFor({ SITE_ACCESS: "private" }, "SITE_ACCESS")).toEqual([expect.objectContaining({ level: "error" })]);
    expect(issuesFor({ SITE_ACCESS: "private", ACCESS_PASSWORD: PASSWORD }, "SITE_ACCESS")).toHaveLength(1);
    const ok = parseEnv({ SITE_ACCESS: "PRIVATE", ACCESS_PASSWORD: PASSWORD, SESSION_SECRET: SECRET });
    expect(ok.siteAccess).toBe("private");
    expect(ok.issues).toEqual([]);
  });

  it("fails closed on an unreadable SITE_ACCESS", () => {
    const env = parseEnv({ SITE_ACCESS: "privat", ACCESS_PASSWORD: PASSWORD, SESSION_SECRET: SECRET });
    expect(env.siteAccess).toBe("private");
    expect(env.issues).toEqual([expect.objectContaining({ key: "SITE_ACCESS", level: "error" })]);
  });
});

describe("authModeOf and startupSummary", () => {
  it("derives the auth mode", () => {
    expect(authModeOf(parseEnv({ ACCESS_PASSWORD: PASSWORD }))).toBe("password");
    expect(authModeOf(parseEnv({ NODE_ENV: "development" }))).toBe("open");
    expect(authModeOf(parseEnv({ NODE_ENV: "production" }))).toBe("disabled");
  });

  it("summarises the configuration without secrets", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DEEPSEEK_API_KEY: "sk-live-abcdefghijklmnop",
      DEEPSEEK_BASE_URL: "https://llm.example.com/v1",
      ACCESS_PASSWORD: PASSWORD,
      SESSION_SECRET: SECRET,
      TRUST_PROXY: "1",
      SITE_ACCESS: "private",
    });
    const summary = startupSummary(env);
    expect(summary).toMatchObject({
      authMode: "password",
      signIn: "ready",
      aiConfigured: true,
      model: DEFAULT_DEEPSEEK_MODEL,
      aiEndpoint: "https://llm.example.com",
      aiDailyLimit: DEFAULT_AI_DAILY_LIMIT,
      proxyTrust: "x-forwarded-for",
      siteAccess: "private",
      dataSource: "yahoo",
    });
    const text = JSON.stringify(summary);
    for (const secret of ["sk-live", PASSWORD, SECRET]) expect(text).not.toContain(secret);
    expect(startupSummary(parseEnv({})).aiEndpoint).toBe("default");
    expect(startupSummary(parseEnv({ VERCEL: "1" })).proxyTrust).toBe("vercel");
  });
});

describe("readEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("re-reads process.env when a variable changes", () => {
    vi.stubEnv("AI_DAILY_LIMIT", "50");
    expect(readEnv().aiDailyLimit).toBe(50);
    expect(readEnv()).toBe(readEnv());
    vi.stubEnv("AI_DAILY_LIMIT", "60");
    expect(readEnv().aiDailyLimit).toBe(60);
  });

  it("parses a given record without touching the memo", () => {
    expect(readEnv({ AI_DAILY_LIMIT: "7" }).aiDailyLimit).toBe(7);
  });
});

describe(".env.example", () => {
  const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  const documented = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);

  it("documents every setting of the schema", () => {
    for (const key of ENV_KEYS) expect(documented, `${key} is missing from .env.example`).toContain(key);
  });

  it("documents nothing the schema does not read", () => {
    for (const key of documented) expect(ENV_KEYS as string[], `${key} in .env.example is not read by lib/server/env.ts`).toContain(key);
  });

  it("parses without errors as shipped", () => {
    const values = Object.fromEntries([...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((match) => [match[1], match[2]]));
    expect(parseEnv(values).issues).toEqual([]);
  });
});
