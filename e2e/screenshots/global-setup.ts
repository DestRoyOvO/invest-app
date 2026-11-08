import { closeSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

import type { FullConfig } from "@playwright/test";

import { BASE_URL, PINNED_NOW } from "../support/env";
import suiteSetup from "../support/global-setup";

import { README_IMAGES } from "./images";

// The suite's global setup (the server is the fixture-data build of this commit, with no network access, and the
// browser state is signed in), plus a note when the server's clock runs: a server from `npm run e2e:serve`, reused
// with E2E_REUSE=1, stamps its data with a clock that runs on from E2E_NOW, so the times in the images follow it.
//
// Its teardown fails the run unless the run wrote all of the README images (images.ts) into the folder it was asked
// for, each at the size of its project's viewport: a capture that writes elsewhere, an image name that changed, a
// shot that was skipped or filtered out, or the phone image captured by the desktop project would otherwise go
// unnoticed, and the folder would hold images from different runs.

async function serverTime(): Promise<number> {
  const health = (await (await fetch(`${BASE_URL}/api/health`)).json()) as { time?: string };
  return Date.parse(health.time ?? "");
}

/**
 * The folder the images must reach: SCREENSHOTS_DIR (absolute, or relative to the repository root), docs/screenshots
 * by default. Resolved here from the environment rather than imported from e2e/support/shots.ts, so a capture that
 * stops honoring SCREENSHOTS_DIR fails the run.
 */
function requestedFolder(): string {
  return path.resolve(__dirname, "..", "..", process.env.SCREENSHOTS_DIR?.trim() || path.join("docs", "screenshots"));
}

/** Width and height of a PNG file, from its header (the IHDR chunk follows the 8-byte signature). */
function pngSize(file: string): { width: number; height: number } | null {
  const header = Buffer.alloc(24);
  const fd = openSync(file, "r");
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  if (header.toString("latin1", 1, 4) !== "PNG" || header.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** The size of each project's images: its viewport in CSS pixels times its device scale factor. */
function projectSizes(config: FullConfig): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const project of config.projects) {
    const viewport = project.use.viewport;
    if (!viewport) continue;
    const scale = project.use.deviceScaleFactor ?? 1;
    sizes.set(project.name, { width: viewport.width * scale, height: viewport.height * scale });
  }
  return sizes;
}

/** Throws unless every README image in the requested folder was written since `since`, at its project's size. */
function checkImages(config: FullConfig, since: number): void {
  const folder = requestedFolder();
  const sizes = projectSizes(config);
  const problems: string[] = [];
  for (const [file, project] of Object.entries(README_IMAGES)) {
    const target = path.join(folder, file);
    let written: number;
    try {
      written = statSync(target).mtimeMs;
    } catch {
      problems.push(`${file}: missing`);
      continue;
    }
    if (written < since) {
      problems.push(`${file}: not written by this run (last written ${new Date(written).toISOString()})`);
      continue;
    }
    const size = pngSize(target);
    const expected = sizes.get(project);
    if (!size) problems.push(`${file}: not a PNG`);
    else if (!expected) problems.push(`${file}: no project "${project}" in the config`);
    else if (size.width !== expected.width || size.height !== expected.height) {
      problems.push(`${file}: ${size.width}x${size.height} pixels, not the ${expected.width}x${expected.height} of the ${project} project`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `${folder} does not hold the ${Object.keys(README_IMAGES).length} README images of this run:\n- ${problems.join("\n- ")}\nA run of some of the shots (-g, a file:line, --project) leaves the other images as they were: run the whole command before committing them.`,
    );
  }
}

export default async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  const startedAt = Date.now();
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
  return async () => {
    await teardown();
    checkImages(config, startedAt);
  };
}
