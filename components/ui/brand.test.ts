import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractTokenSources, resolveTokens } from "@/lib/design-tokens";

import { BRAND_COLORS, BRAND_HEAT, markSvg, THEME_COLORS, themeColorFor } from "./brand";

const root = process.cwd();

describe("brand mark", () => {
  it("app/icon.svg is the generated mark (regenerate it with markSvg when the geometry changes)", () => {
    const icon = readFileSync(join(root, "app", "icon.svg"), "utf8").trim();
    expect(icon).toBe(markSvg({ size: 32, background: BRAND_COLORS.background, radius: 6, padding: 3 }));
  });

  it("scales the 24-unit glyph into the padded box", () => {
    expect(markSvg({ size: 24 })).toContain('transform="translate(0 0) scale(1)"');
    expect(markSvg({ size: 180, padding: 36 })).toContain("scale(4.5)");
    expect(markSvg({ size: 24 })).not.toContain("<rect width");
  });
});

describe("brand colors", () => {
  const sources = extractTokenSources(readFileSync(join(root, "app", "globals.css"), "utf8"));
  const dark = resolveTokens(sources, "dark", "intl");
  const light = resolveTokens(sources, "light", "intl");

  it("match the dark theme tokens", () => {
    expect(BRAND_COLORS.background).toBe(dark.get("--canvas"));
    expect(BRAND_COLORS.glyph).toBe(dark.get("--accent"));
    expect(BRAND_COLORS.text).toBe(dark.get("--fg"));
    expect(BRAND_COLORS.muted).toBe(dark.get("--fg-2"));
  });

  it("copy the heatmap steps of the dark theme, down 4 to up 4", () => {
    const steps = [...[4, 3, 2, 1].map((n) => `--heat-down-${n}`), "--heat-flat", ...[1, 2, 3, 4].map((n) => `--heat-up-${n}`)];
    expect([...BRAND_HEAT]).toEqual(steps.map((name) => dark.get(name)));
  });

  it("theme-color follows the canvas of each theme", () => {
    expect(THEME_COLORS.dark).toBe(dark.get("--canvas"));
    expect(THEME_COLORS.light).toBe(light.get("--canvas"));
    expect(themeColorFor("dark")).toBe(THEME_COLORS.dark);
    expect(themeColorFor("light")).toBe(THEME_COLORS.light);
    expect(themeColorFor("system")).toEqual([
      { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
      { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    ]);
  });
});
