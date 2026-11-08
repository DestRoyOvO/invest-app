import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTRAST_PAIRS,
  CONVENTIONS,
  THEMES,
  checkContrast,
  composite,
  contrastRatio,
  duplicatePairs,
  extractTokenSources,
  oklabDistance,
  pairName,
  parseColor,
  parseCssBlocks,
  resolveTokens,
} from "./design-tokens";

const FIXTURE = `
@theme inline { --color-fg: var(--fg); }
@layer base {
  /* comment with { braces } */
  :root {
    color-scheme: dark;
    --fg: #e6e9ed;
    --panel: #0c0f13;
    --green: #2fbf71;
    --red: #f0525a;
    --link: var(--fg);
    @variant theme-light {
      --fg: #0e1318;
      --panel: #ffffff;
    }
  }
  :root {
    --up: var(--green);
    --down: var(--red);
  }
  :root[data-updown="cn"] {
    --up: var(--red);
    --down: var(--green);
  }
}
`;

describe("parseCssBlocks", () => {
  it("parses nested blocks and declarations, ignoring comments", () => {
    const blocks = parseCssBlocks(FIXTURE);
    expect(blocks.map((b) => b.prelude)).toEqual(["@theme inline", "@layer base"]);
    const layer = blocks[1];
    expect(layer.children.map((b) => b.prelude)).toEqual([":root", ":root", ':root[data-updown="cn"]']);
    expect(layer.children[0].decls.get("--fg")).toBe("#e6e9ed");
    expect(layer.children[0].decls.get("color-scheme")).toBe("dark");
    expect(layer.children[0].children[0].prelude).toBe("@variant theme-light");
  });
});

describe("resolveTokens", () => {
  const sources = extractTokenSources(FIXTURE);

  it("collects base, light and convention overrides", () => {
    expect(sources.base.get("--up")).toBe("var(--green)");
    expect(sources.light.get("--panel")).toBe("#ffffff");
    expect(sources.conventions.cn.get("--up")).toBe("var(--red)");
    expect(sources.base.has("--color-fg")).toBe(false);
  });

  it("applies the theme and convention, then resolves var() chains", () => {
    const dark = resolveTokens(sources, "dark", "intl");
    expect(dark.get("--up")).toBe("#2fbf71");
    expect(dark.get("--link")).toBe("#e6e9ed");
    const light = resolveTokens(sources, "light", "intl");
    expect(light.get("--link")).toBe("#0e1318");
    const cn = resolveTokens(sources, "dark", "cn");
    expect(cn.get("--up")).toBe("#f0525a");
    expect(cn.get("--down")).toBe("#2fbf71");
  });

  it("throws on a reference cycle", () => {
    const looped = extractTokenSources(":root { --a: var(--b); --b: var(--a); }");
    expect(() => resolveTokens(looped, "dark", "intl")).toThrow(/cycle/);
  });
});

describe("colors and contrast", () => {
  it("parses hex and rgb() colors", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0C0F13")).toEqual({ r: 12, g: 15, b: 19, a: 1 });
    expect(parseColor("rgb(242 163 58 / 0.13)")).toEqual({ r: 242, g: 163, b: 58, a: 0.13 });
    expect(parseColor("rgba(0, 0, 0, 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor("var(--x)")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
  });

  it("computes WCAG ratios", () => {
    expect(contrastRatio(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor("#777777")!, parseColor("#ffffff")!)).toBeCloseTo(4.48, 2);
    expect(contrastRatio(parseColor("#fff")!, parseColor("#fff")!)).toBe(1);
  });

  it("composites translucent colors", () => {
    expect(composite({ r: 255, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 255, a: 1 })).toEqual({ r: 127.5, g: 0, b: 127.5, a: 1 });
  });

  it("measures OKLab distance", () => {
    expect(oklabDistance(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(1, 2);
    expect(oklabDistance(parseColor("#2d674b")!, parseColor("#2e6b4c")!)).toBeLessThan(0.02);
  });
});

describe("pairName and duplicatePairs", () => {
  it("names a pair by its colors, with the surface under a translucent background", () => {
    expect(pairName({ fg: "fg-3", bg: "hover" })).toBe("fg-3 on hover");
    expect(pairName({ fg: "accent", bg: "accent-soft", over: "panel-2" })).toBe("accent on accent-soft over panel-2");
  });

  it("reports colors listed twice whatever their roles and minimums, once each", () => {
    const pairs = [
      { fg: "warn", bg: "hover", min: 4.5, role: "Caveats on a hovered row" },
      { fg: "warn", bg: "hover", min: 4.5, role: "Earnings within 7 days on a hovered row" },
      { fg: "warn", bg: "hover", min: 3, role: "A third copy" },
      { fg: "accent", bg: "accent-soft", over: "panel", min: 4.5, role: "Active icon button" },
      { fg: "accent", bg: "accent-soft", over: "hover", min: 4.5, role: "Badge on a hovered row" },
      { fg: "fg", bg: "line-2", min: 3, role: "Marker" },
    ];
    expect(duplicatePairs(pairs)).toEqual(["warn on hover"]);
    expect(duplicatePairs(pairs.slice(3))).toEqual([]);
  });
});

describe("app/globals.css", () => {
  const sources = extractTokenSources(readFileSync(join(process.cwd(), "app", "globals.css"), "utf8"));

  it("meets every contrast pair in both themes and all three conventions", () => {
    const failures = THEMES.flatMap((theme) =>
      CONVENTIONS.flatMap((convention) => checkContrast(resolveTokens(sources, theme, convention), theme, convention).filter((r) => !r.pass)),
    );
    expect(failures.map((f) => `${f.theme}/${f.convention} ${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)}`)).toEqual([]);
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(40);
  });

  it("lists every pair once", () => {
    expect(duplicatePairs()).toEqual([]);
  });

  it("checks the accent marker on a track (signal gauge, whisker dot)", () => {
    expect(CONTRAST_PAIRS.map(pairName)).toContain("accent on line-2");
  });

  it("swaps up and down for the red-up convention, heatmap included", () => {
    for (const theme of THEMES) {
      const intl = resolveTokens(sources, theme, "intl");
      const cn = resolveTokens(sources, theme, "cn");
      expect(cn.get("--up")).toBe(intl.get("--red"));
      expect(cn.get("--down")).toBe(intl.get("--green"));
      for (const step of [1, 2, 3, 4]) {
        expect(cn.get(`--heat-up-${step}`)).toBe(intl.get(`--heat-down-${step}`));
        expect(cn.get(`--heat-down-${step}`)).toBe(intl.get(`--heat-up-${step}`));
      }
    }
  });

  it("uses blue up and orange down in the color-blind convention, with its own heat ramps", () => {
    for (const theme of THEMES) {
      const cb = resolveTokens(sources, theme, "cb");
      expect(cb.get("--up")).toBe(cb.get("--blue"));
      expect(cb.get("--down")).toBe(cb.get("--orange"));
      expect(cb.get("--heat-up-4")).toBe(cb.get("--blue"));
      expect(cb.get("--heat-down-1")).toBe(cb.get("--heat-orange-1"));
      // A moving average must not look like an up move.
      expect(cb.get("--series-1")).not.toBe(cb.get("--up"));
    }
  });

  it("keeps errors red whatever the convention", () => {
    for (const convention of CONVENTIONS) {
      const tokens = resolveTokens(sources, "dark", convention);
      expect(tokens.get("--danger")).toBe(tokens.get("--red"));
    }
  });

  it("makes neighbouring heatmap steps visibly different", () => {
    for (const theme of THEMES) {
      for (const convention of CONVENTIONS) {
        const tokens = resolveTokens(sources, theme, convention);
        for (const side of ["up", "down"]) {
          const steps = ["--heat-flat", ...[1, 2, 3, 4].map((n) => `--heat-${side}-${n}`)].map((name) => parseColor(tokens.get(name)!)!);
          for (let i = 1; i < steps.length; i++) expect(oklabDistance(steps[i - 1], steps[i])).toBeGreaterThan(0.05);
        }
      }
    }
  });

  it("defines the light theme for the system theme too", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    expect(css).toMatch(/@custom-variant theme-light \{[\s\S]*&\[data-theme="light"\][\s\S]*@media \(prefers-color-scheme: light\)[\s\S]*&\[data-theme="system"\]/);
  });
});
