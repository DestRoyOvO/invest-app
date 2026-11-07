import "server-only";

import { readEnv, startupSummary, type ServerEnv } from "./env";
import { log } from "./log";
import { APP_VERSION } from "./version";

// Startup checks run by instrumentation.ts once per server process.

export class UnsafeConfigurationError extends Error {
  constructor(messages: readonly string[]) {
    super(`Refusing to start with an unsafe configuration: ${messages.join(" ")}`);
    this.name = "UnsafeConfigurationError";
  }
}

/**
 * Logs one "startup" line describing the configuration (modes and limits, never secrets) and one "config.issue" line
 * per problem found by env.ts. In production an issue of level "error" throws UnsafeConfigurationError; in development
 * the server keeps running so the problem can be fixed.
 */
export function runStartupChecks(env: ServerEnv = readEnv()): void {
  log("info", "startup", { version: APP_VERSION, ...startupSummary(env) });
  for (const issue of env.issues) {
    log(issue.level === "error" ? "error" : "warn", "config.issue", { key: issue.key, message: issue.message });
  }
  const errors = env.issues.filter((issue) => issue.level === "error").map((issue) => issue.message);
  if (env.isProduction && errors.length > 0) throw new UnsafeConfigurationError(errors);
}

/**
 * Ends the process once stdout and stderr have flushed. Writes to a pipe (Docker's log driver) are asynchronous on
 * Linux, so exiting at once could drop the lines that explain why the server stopped.
 */
export function exitAfterFlush(code: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}
