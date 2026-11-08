// Builds the app and keeps the two servers of the end-to-end suite running, exactly as playwright.config.ts starts
// them (the same environment, preloads and ports), so the suite can run against them again and again:
//
//   npm run e2e:serve                  # build, then serve until Ctrl+C
//   npm run e2e:serve -- --no-build    # serve the existing build
//   E2E_REUSE=1 npm run e2e            # in another terminal
//
// The global setup checks that the app it finds is the fixture-mode build of the checked-out commit and that its clock
// started at E2E_NOW, so rebuild (restart this script) after committing or changing E2E_NOW.

import { spawn, type ChildProcess } from "node:child_process";

import { APP_SERVER_ARGS, appEnv, BASE_URL, E2E_NOW, LLM_URL, MOCK_ENV, MOCK_SERVER_ARGS } from "./support/env";

const children: ChildProcess[] = [];

function stopAll(code: number): never {
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exit(code);
}

function run(command: string, args: string[], env: Record<string, string>, options: { shell?: boolean } = {}): ChildProcess {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: "inherit", shell: options.shell ?? false });
  children.push(child);
  return child;
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

async function main(): Promise<void> {
  process.on("SIGINT", () => stopAll(0));
  process.on("SIGTERM", () => stopAll(0));
  const env = appEnv();

  if (!process.argv.includes("--no-build")) {
    // npm is a script on Windows (npm.cmd), so it runs through the shell.
    const build = run("npm", ["run", "build"], env, { shell: true });
    const code = await new Promise<number>((resolve) => build.on("exit", (exitCode) => resolve(exitCode ?? 1)));
    children.length = 0;
    if (code !== 0) process.exit(code);
  }

  for (const child of [run(process.execPath, MOCK_SERVER_ARGS, MOCK_ENV), run(process.execPath, APP_SERVER_ARGS, env)]) {
    child.on("exit", (code) => {
      console.error(`[e2e:serve] a server stopped (exit code ${code ?? "none"}), stopping the other one.`);
      stopAll(code ?? 1);
    });
  }
  await Promise.all([waitFor(`${LLM_URL}/health`, 30_000), waitFor(`${BASE_URL}/api/health`, 120_000)]);
  console.log(`[e2e:serve] app on ${BASE_URL} (clock from ${E2E_NOW}), mock model on ${LLM_URL}. Run the suite with E2E_REUSE=1 npm run e2e; Ctrl+C stops both.`);
}

main().catch((error: unknown) => {
  console.error(`[e2e:serve] ${error instanceof Error ? error.message : String(error)}`);
  stopAll(1);
});
