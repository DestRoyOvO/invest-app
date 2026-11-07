import "server-only";

import { readEnv, type LogLevel } from "./env";

// Structured server logs: one JSON object per line, {"ts","level","event",...fields}, so `docker logs` output and log
// collectors can be filtered by event name. Fields are sanitised on the way out: keys that can carry credentials,
// cookies or model input are redacted, strings that look like API keys are masked, errors are reduced to name,
// message and code, and long values are cut. Call sites log identifiers and counts, never request bodies or prompts.

export type LogEventLevel = Exclude<LogLevel, "silent">;
export type LogFields = Readonly<Record<string, unknown>>;

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Resolved at call time, so tests can spy on console methods after this module has loaded.
const SINKS: Readonly<Record<LogEventLevel, (line: string) => void>> = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

/** Lower-case key endings whose values are never written: credentials, cookies and model input. */
const SENSITIVE_KEY_ENDINGS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "cookies",
  "sessionkey",
  "prompt",
  "messages",
  "content",
] as const;

const RESERVED_KEYS: ReadonlySet<string> = new Set(["ts", "level", "event"]);
const MAX_STRING = 500;
const MAX_STACK = 2_000;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

/** Masks bearer tokens and OpenAI-style keys ("sk-...") that slipped into a message. */
function maskSecrets(text: string): string {
  return text.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***").replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***");
}

function clip(text: string, max = MAX_STRING): string {
  const masked = maskSecrets(text);
  return masked.length > max ? `${masked.slice(0, max)}…` : masked;
}

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_ENDINGS.some((ending) => lower.endsWith(ending));
}

/**
 * The parts of an error worth logging: name, message, code, HTTP status, Next's digest and one level of cause. The stack
 * is included only for error-level events, where it is needed to fix a bug.
 */
export function serializeError(error: unknown, withStack = false, depth = 0): Record<string, unknown> | string {
  if (!(error instanceof Error)) return clip(typeof error === "string" ? error : String(error));
  const details = error as Error & { code?: unknown; status?: unknown; digest?: unknown };
  const out: Record<string, unknown> = { name: error.name, message: clip(error.message) };
  if (typeof details.code === "string" || typeof details.code === "number") out.code = details.code;
  if (typeof details.status === "number") out.status = details.status;
  if (typeof details.digest === "string") out.digest = details.digest;
  if (error.cause !== undefined && depth < 2) out.cause = serializeError(error.cause, false, depth + 1);
  if (withStack && error.stack) out.stack = clip(error.stack, MAX_STACK);
  return out;
}

function sanitize(value: unknown, withStack: boolean, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case "string":
      return clip(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
      return `[${typeof value}]`;
  }
  if (value instanceof Error) return serializeError(value, withStack);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const object = value as object;
  if (seen.has(object)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[object]";
  // `seen` holds the objects on the current path only, so a value shared by two fields is not mistaken for a cycle.
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const items = object.slice(0, MAX_ARRAY).map((item) => sanitize(item, withStack, depth + 1, seen));
      if (object.length > MAX_ARRAY) items.push(`…${object.length - MAX_ARRAY} more`);
      return items;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) {
      out[key] = isSensitiveKey(key) ? "[redacted]" : sanitize(item, withStack, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/** One log line as JSON. Pure: the time is an argument, so tests can pin it. */
export function formatLogLine(level: LogEventLevel, event: string, fields: LogFields = {}, now: Date = new Date()): string {
  const line: Record<string, unknown> = { ts: now.toISOString(), level, event };
  const seen = new WeakSet<object>();
  for (const [key, value] of Object.entries(fields)) {
    const name = RESERVED_KEYS.has(key) ? `_${key}` : key;
    line[name] = isSensitiveKey(key) ? "[redacted]" : sanitize(value, level === "error", 1, seen);
  }
  return JSON.stringify(line);
}

/** True when LOG_LEVEL lets events of this level through. */
export function isLogLevelEnabled(level: LogEventLevel, threshold: LogLevel = readEnv().logLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[threshold];
}

/**
 * Writes one structured event: debug and info to stdout, warn and error to stderr. Event names are dotted and stable
 * ("yahoo.stale_served", "ai.request_failed") so they can be searched for. Never throws.
 */
export function log(level: LogEventLevel, event: string, fields: LogFields = {}): void {
  try {
    if (!isLogLevelEnabled(level)) return;
    SINKS[level](formatLogLine(level, event, fields));
  } catch {
    // Logging must never break a request; fall back to a line without the fields.
    SINKS[level](JSON.stringify({ ts: new Date().toISOString(), level, event, logError: true }));
  }
}
