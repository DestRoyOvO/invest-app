import "server-only";

import { z } from "zod";

// The single reader of the app's environment variables. One zod schema describes every setting and parseEnv() turns
// the raw strings into typed values. An invalid value never fails a request: it falls back to the documented default
// and is reported as an issue, which instrumentation.ts logs at startup. Production refuses to start only for issues of
// level "error", the combinations that would leave a deployment unsafe or impossible to sign in to.
//
// Every schema key must be documented in .env.example (env.test.ts enforces it). Platform values (NODE_ENV, VERCEL and
// the commit SHA) are read here too, but they are set by the platform or the build, not by the owner.

export type RawEnv = Readonly<Record<string, string | undefined>>;

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const MARKET_DATA_SOURCES = ["yahoo", "fixtures", "record"] as const;
export type MarketDataSource = (typeof MARKET_DATA_SOURCES)[number];
/** Sources this build can serve. "fixtures" and "record" are reserved for the replay mode of the end-to-end suite. */
const AVAILABLE_DATA_SOURCES: ReadonlySet<MarketDataSource> = new Set(["yahoo"]);

export const SITE_ACCESS_MODES = ["public", "private"] as const;
export type SiteAccess = (typeof SITE_ACCESS_MODES)[number];

export type AuthMode = "password" | "open" | "disabled";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
export const DEFAULT_AI_DAILY_LIMIT = 200;
export const MIN_SESSION_SECRET_LENGTH = 32;
/** Shorter access passwords still work, but startup reports them as weak. */
export const RECOMMENDED_PASSWORD_LENGTH = 12;
/** The longest password the sign-in form accepts (loginRequestSchema in ai-schemas.ts; env.test.ts keeps them equal). */
export const MAX_ACCESS_PASSWORD_LENGTH = 256;

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TRUE_VALUES: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES: ReadonlySet<string> = new Set(["0", "false", "no", "off"]);
const SECRET_GENERATOR = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

/** Blank values count as unset, so `KEY=` in an env file means "use the default". */
function blank(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function trimmed(value: unknown): unknown {
  const present = blank(value);
  return typeof present === "string" ? present.trim() : present;
}

function lowerCased(value: unknown): unknown {
  const present = trimmed(value);
  return typeof present === "string" ? present.toLowerCase() : present;
}

/** localhost, 127.0.0.0/8 or [::1]: the only hosts a plain-http DeepSeek base URL may point at (local mock servers). */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]") return true;
  const parts = host.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** An https URL, or http on a loopback host, without credentials, query or fragment (the SDK appends API paths). */
export function isAllowedBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

const flag = z.preprocess(lowerCased, z.string().optional()).transform((value, ctx) => {
  if (value === undefined || FALSE_VALUES.has(value)) return false;
  if (TRUE_VALUES.has(value)) return true;
  ctx.addIssue({ code: "custom", message: "must be 1 or 0" });
  return z.NEVER;
});

/** The settings an owner configures. Values are validated per key, so one bad value only resets that key. */
export const envSchema = z.object({
  DEEPSEEK_API_KEY: z.preprocess(trimmed, z.string().optional()),
  DEEPSEEK_MODEL: z.preprocess(
    trimmed,
    z.string().regex(MODEL_PATTERN, "must look like a model id, e.g. deepseek-chat").default(DEFAULT_DEEPSEEK_MODEL),
  ),
  DEEPSEEK_BASE_URL: z.preprocess(
    trimmed,
    z
      .string()
      .refine(isAllowedBaseUrl, "must be an https URL (plain http only on localhost) without credentials or query")
      .default(DEFAULT_DEEPSEEK_BASE_URL),
  ),
  // The password and the secret are used exactly as written (no trimming), as before this module existed.
  ACCESS_PASSWORD: z.preprocess(blank, z.string().optional()),
  SESSION_SECRET: z.preprocess(blank, z.string().optional()),
  AI_DAILY_LIMIT: z.preprocess(
    trimmed,
    z
      .string()
      .regex(/^\d{1,7}$/, "must be a whole number from 1 to 9999999")
      .transform(Number)
      .refine((limit) => limit > 0, "must be a whole number from 1 to 9999999")
      .default(DEFAULT_AI_DAILY_LIMIT),
  ),
  TRUST_PROXY: flag,
  SITE_ACCESS: z.preprocess(lowerCased, z.enum(SITE_ACCESS_MODES, { error: "must be public or private" }).default("public")),
  SITE_URL: z.preprocess(trimmed, z.string().refine(isHttpUrl, "must be an absolute http(s) URL, e.g. https://invest.example.com").optional()),
  LOG_LEVEL: z.preprocess(lowerCased, z.enum(LOG_LEVELS, { error: "must be debug, info, warn, error or silent" }).default("info")),
  MARKET_DATA_SOURCE: z.preprocess(
    lowerCased,
    z.enum(MARKET_DATA_SOURCES, { error: "must be yahoo, fixtures or record" }).default("yahoo"),
  ),
});

export type EnvKey = keyof typeof envSchema.shape;
type EnvValues = { [K in EnvKey]: z.output<(typeof envSchema.shape)[K]> };

export const ENV_KEYS = Object.keys(envSchema.shape) as EnvKey[];

/**
 * Keys whose invalid values are quoted in the issue message. Secrets and URLs (which can carry credentials or tokens)
 * are never echoed.
 */
const ECHOED_KEYS: ReadonlySet<EnvKey> = new Set(["DEEPSEEK_MODEL", "AI_DAILY_LIMIT", "TRUST_PROXY", "SITE_ACCESS", "LOG_LEVEL", "MARKET_DATA_SOURCE"]);

/** Fallbacks for invalid values that differ from the default: an unreadable SITE_ACCESS fails closed. */
const INVALID_FALLBACK: Partial<EnvValues> = { SITE_ACCESS: "private" };

export interface EnvIssue {
  key: EnvKey;
  /** "error" issues stop a production server from starting; in development they are logged and the server runs. */
  level: "warn" | "error";
  message: string;
}

export interface ServerEnv {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  /** Running on Vercel (the platform sets the client address headers). */
  onVercel: boolean;
  /** Build commit from VERCEL_GIT_COMMIT_SHA or the GIT_SHA build argument, lower-case hex, or null. */
  commit: string | null;
  deepseekApiKey: string | null;
  deepseekModel: string;
  deepseekBaseUrl: string;
  accessPassword: string | null;
  /** SESSION_SECRET when it is long enough to sign sessions, otherwise null (sign-in stays off). */
  sessionSecret: string | null;
  aiDailyLimit: number;
  trustProxy: boolean;
  siteAccess: SiteAccess;
  /** Public origin of the deployment (SITE_URL), or null. */
  siteUrl: string | null;
  logLevel: LogLevel;
  marketDataSource: MarketDataSource;
  issues: readonly EnvIssue[];
}

function describeValue(key: EnvKey, value: string | undefined): string {
  if (!ECHOED_KEYS.has(key) || value === undefined) return "";
  const shown = value.trim();
  return ` (got ${JSON.stringify(shown.length > 40 ? `${shown.slice(0, 40)}…` : shown)})`;
}

function parseFields(raw: RawEnv): { values: EnvValues; issues: EnvIssue[] } {
  const values: Record<string, unknown> = {};
  const issues: EnvIssue[] = [];
  for (const key of ENV_KEYS) {
    const field = envSchema.shape[key];
    const result = field.safeParse(raw[key]);
    if (result.success) {
      values[key] = result.data;
      continue;
    }
    const fallback = key in INVALID_FALLBACK ? INVALID_FALLBACK[key] : field.parse(undefined);
    values[key] = fallback;
    const reason = result.error.issues[0]?.message ?? "is invalid";
    issues.push({
      key,
      level: key === "SITE_ACCESS" ? "error" : "warn",
      message: `${key} ${reason}${describeValue(key, raw[key])}; using ${fallback === undefined ? "nothing" : JSON.stringify(fallback)}.`,
    });
  }
  return { values: values as EnvValues, issues };
}

function normalizeCommit(value: string | undefined): string | null {
  const sha = value?.trim().toLowerCase();
  return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

function nodeEnvOf(value: string | undefined): ServerEnv["nodeEnv"] {
  return value === "production" || value === "test" ? value : "development";
}

/** Parses an environment (process.env or a test record) into typed settings plus the issues found. Pure. */
export function parseEnv(raw: RawEnv): ServerEnv {
  const { values, issues } = parseFields(raw);
  const nodeEnv = nodeEnvOf(raw.NODE_ENV);
  const isProduction = nodeEnv === "production";

  const password = values.ACCESS_PASSWORD ?? null;
  const rawSecret = values.SESSION_SECRET ?? null;
  const secretOk = rawSecret !== null && rawSecret.length >= MIN_SESSION_SECRET_LENGTH;

  if (password !== null) {
    if (rawSecret === null) {
      issues.push({
        key: "SESSION_SECRET",
        level: "error",
        message: `ACCESS_PASSWORD is set but SESSION_SECRET is not, so nobody can sign in. Generate one with: ${SECRET_GENERATOR}`,
      });
    } else if (!secretOk) {
      issues.push({
        key: "SESSION_SECRET",
        level: "error",
        message: `SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} characters, so nobody can sign in. Generate one with: ${SECRET_GENERATOR}`,
      });
    }
    if (password.length > MAX_ACCESS_PASSWORD_LENGTH) {
      issues.push({
        key: "ACCESS_PASSWORD",
        level: "error",
        message: `ACCESS_PASSWORD is longer than ${MAX_ACCESS_PASSWORD_LENGTH} characters, the most the sign-in form accepts, so nobody can sign in.`,
      });
    } else if (password.length < RECOMMENDED_PASSWORD_LENGTH) {
      issues.push({
        key: "ACCESS_PASSWORD",
        level: "warn",
        message: `ACCESS_PASSWORD is shorter than ${RECOMMENDED_PASSWORD_LENGTH} characters; a longer passphrase is much harder to guess.`,
      });
    }
  } else if (rawSecret !== null) {
    issues.push({ key: "SESSION_SECRET", level: "warn", message: "SESSION_SECRET has no effect without ACCESS_PASSWORD." });
  }

  if (values.SITE_ACCESS === "private" && (password === null || !secretOk)) {
    issues.push({
      key: "SITE_ACCESS",
      level: "error",
      message: `SITE_ACCESS=private needs ACCESS_PASSWORD and a SESSION_SECRET of ${MIN_SESSION_SECRET_LENGTH}+ characters; without them nobody can open the site.`,
    });
  }

  if (isProduction && values.DEEPSEEK_API_KEY !== undefined && password === null) {
    issues.push({
      key: "ACCESS_PASSWORD",
      level: "warn",
      message: "DEEPSEEK_API_KEY is set but ACCESS_PASSWORD is not, so the AI features stay off in production.",
    });
  }

  let marketDataSource = values.MARKET_DATA_SOURCE;
  if (!AVAILABLE_DATA_SOURCES.has(marketDataSource)) {
    issues.push({
      key: "MARKET_DATA_SOURCE",
      level: "warn",
      message: `MARKET_DATA_SOURCE=${marketDataSource} is not available in this build yet; market data comes from Yahoo.`,
    });
    marketDataSource = "yahoo";
  }

  return {
    nodeEnv,
    isProduction,
    onVercel: Boolean(raw.VERCEL?.trim()),
    commit: normalizeCommit(raw.VERCEL_GIT_COMMIT_SHA) ?? normalizeCommit(raw.GIT_SHA),
    deepseekApiKey: values.DEEPSEEK_API_KEY ?? null,
    deepseekModel: values.DEEPSEEK_MODEL,
    deepseekBaseUrl: values.DEEPSEEK_BASE_URL,
    accessPassword: password,
    sessionSecret: secretOk ? rawSecret : null,
    aiDailyLimit: values.AI_DAILY_LIMIT,
    trustProxy: values.TRUST_PROXY,
    siteAccess: values.SITE_ACCESS,
    siteUrl: values.SITE_URL === undefined ? null : new URL(values.SITE_URL).origin,
    logLevel: values.LOG_LEVEL,
    marketDataSource,
    issues,
  };
}

const PLATFORM_KEYS = ["NODE_ENV", "VERCEL", "VERCEL_GIT_COMMIT_SHA", "GIT_SHA"] as const;
const SIGNATURE_KEYS: readonly string[] = [...ENV_KEYS, ...PLATFORM_KEYS];

let memo: { signature: string; env: ServerEnv } | null = null;

/**
 * The settings for this process. Parsed again whenever one of the variables changes (cheap to check), so tests that
 * stub variables and dev servers that reload .env files see the new values without a restart.
 */
export function readEnv(source: RawEnv = process.env): ServerEnv {
  if (source !== process.env) return parseEnv(source);
  const signature = SIGNATURE_KEYS.map((key) => source[key] ?? "\u0000").join("\u0001");
  if (memo?.signature !== signature) memo = { signature, env: parseEnv(source) };
  return memo.env;
}

/** "password" when ACCESS_PASSWORD is set; otherwise AI is open in development and disabled in production. */
export function authModeOf(env: Pick<ServerEnv, "accessPassword" | "isProduction">): AuthMode {
  if (env.accessPassword !== null) return "password";
  return env.isProduction ? "disabled" : "open";
}

/** One-line description of the configuration for the startup log. Contains no secrets, only modes and limits. */
export function startupSummary(env: ServerEnv): Record<string, string | number | boolean | null> {
  return {
    nodeEnv: env.nodeEnv,
    commit: env.commit,
    authMode: authModeOf(env),
    signIn: env.accessPassword === null ? "off" : env.sessionSecret === null ? "unavailable" : "ready",
    aiConfigured: env.deepseekApiKey !== null,
    model: env.deepseekModel,
    aiEndpoint: env.deepseekBaseUrl === DEFAULT_DEEPSEEK_BASE_URL ? "default" : new URL(env.deepseekBaseUrl).origin,
    aiDailyLimit: env.aiDailyLimit,
    proxyTrust: env.onVercel ? "vercel" : env.trustProxy ? "x-forwarded-for" : "off",
    siteAccess: env.siteAccess,
    siteUrl: env.siteUrl,
    dataSource: env.marketDataSource,
    logLevel: env.logLevel,
  };
}
