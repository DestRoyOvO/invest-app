import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DASH } from "@/lib/format";

// Source-level checks for rules in docs/design-system.md that the primitives must keep and a unit test cannot see.

const dir = join(process.cwd(), "components", "ui");
/** The source without comments: comments may mention what the code must not contain. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sources = readdirSync(dir)
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
  .map((name) => ({ name, code: code(readFileSync(join(dir, name), "utf8")) }));

describe("components/ui conventions", () => {
  it("shows a missing value as DASH from lib/format, never a typed em or en dash", () => {
    expect(DASH).toBe("—");
    expect(sources.filter((file) => /[–—]/.test(file.code)).map((file) => file.name)).toEqual([]);
  });

  it("puts no <header> inside a dialog, where it would be a second banner landmark", () => {
    const dialogs = sources.filter((file) => file.code.includes('role="dialog"'));
    expect(dialogs.map((file) => file.name)).toContain("Drawer.tsx");
    expect(dialogs.filter((file) => file.code.includes("<header")).map((file) => file.name)).toEqual([]);
  });
});
