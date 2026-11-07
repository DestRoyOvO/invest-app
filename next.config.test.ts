import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { describe, expect, it } from "vitest";

import configFor from "./next.config";

describe("next.config", () => {
  it("writes the standalone server for the Docker image during next build only", () => {
    expect(configFor(PHASE_PRODUCTION_BUILD).output).toBe("standalone");
    // next start serves the regular build and would warn about a standalone setting it does not use.
    expect(configFor(PHASE_PRODUCTION_SERVER).output).toBeUndefined();
    expect(configFor(PHASE_DEVELOPMENT_SERVER).output).toBeUndefined();
  });

  it("sends the same security headers whatever the phase", async () => {
    const build = await configFor(PHASE_PRODUCTION_BUILD).headers?.();
    const server = await configFor(PHASE_PRODUCTION_SERVER).headers?.();
    expect(server).toEqual(build);
    expect(JSON.stringify(server)).toContain("Cross-Origin-Opener-Policy");
  });
});
