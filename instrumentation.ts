// Runs once when a server process starts: next start, the Docker image, each Vercel instance and next dev.
// It validates the environment (lib/server/env.ts), logs one summary line without secrets plus one line per problem,
// and stops a production server whose configuration is unsafe. NEXT_RUNTIME and NEXT_PHASE are Next's own markers,
// read here directly because they decide whether the server modules may be loaded at all.

export async function register(): Promise<void> {
  // Node.js only (the checks use Node APIs), and never inside `next build`, which runs without production secrets.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { exitAfterFlush, runStartupChecks, UnsafeConfigurationError } = await import("./lib/server/startup");
  try {
    runStartupChecks();
  } catch (error) {
    // Next.js keeps a server whose register() failed running and answers every request with a 500. Stop the process
    // instead, so the platform reports a failed start next to the logged reasons (Docker restarts it with a backoff).
    if (error instanceof UnsafeConfigurationError) exitAfterFlush(1);
    throw error;
  }
}
