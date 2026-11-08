import type { FullConfig } from "@playwright/test";

import { BASE_URL, PINNED_NOW } from "../support/env";
import suiteSetup from "../support/global-setup";

// The suite's global setup (the server is the fixture-data build of this commit, with no network access, and the
// browser state is signed in), plus a note when the server's clock runs: a server from `npm run e2e:serve`, reused
// with E2E_REUSE=1, stamps its data with a clock that runs on from E2E_NOW, so the times in the images follow it.

async function serverTime(): Promise<number> {
  const health = (await (await fetch(`${BASE_URL}/api/health`)).json()) as { time?: string };
  return Date.parse(health.time ?? "");
}

export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  const teardown = await suiteSetup(config);
  if (PINNED_NOW !== null) {
    const first = await serverTime();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    if ((await serverTime()) !== first) {
      console.warn(
        "[screenshots] The server's clock runs (a server of `npm run e2e:serve`?): the times it stamps on its data follow it, so the images can differ from run to run. Let `npm run screenshots` start its own servers for images that are the same every time.",
      );
    }
  }
  return teardown;
}
