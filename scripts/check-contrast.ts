// WCAG contrast report for the design tokens in app/globals.css: every pair in lib/design-tokens.ts, in both themes and
// all three price conventions, plus the OKLab distance between neighbouring heatmap steps.
//
//   npx tsx scripts/check-contrast.ts            (exits 1 when a pair is below its minimum)
//   npx tsx scripts/check-contrast.ts --markdown (the same report as a Markdown table)

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONTRAST_PAIRS,
  CONVENTIONS,
  THEMES,
  checkContrast,
  extractTokenSources,
  oklabDistance,
  parseColor,
  resolveTokens,
  type ContrastResult,
} from "../lib/design-tokens";

const markdown = process.argv.includes("--markdown");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const sources = extractTokenSources(css);

const scenarios = THEMES.flatMap((theme) => CONVENTIONS.map((convention) => ({ theme, convention })));
const results = new Map<string, ContrastResult[]>();
for (const { theme, convention } of scenarios) {
  results.set(`${theme}/${convention}`, checkContrast(resolveTokens(sources, theme, convention), theme, convention));
}

const columns = scenarios.map(({ theme, convention }) => `${theme}/${convention}`);
const cell = (r: ContrastResult) => `${r.ratio.toFixed(2)}${r.pass ? "" : " FAIL"}`;
const rows = CONTRAST_PAIRS.map((pair, i) => {
  const name = `${pair.fg} on ${pair.over ? `${pair.bg} over ${pair.over}` : pair.bg}`;
  return [name, pair.role, `${pair.min}`, ...columns.map((key) => cell(results.get(key)![i]))];
});
const header = ["Pair", "Role", "Min", ...columns];

if (markdown) {
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
} else {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  for (const row of rows) console.log(line(row));
}

// Neighbouring heatmap steps should be visibly different: about 0.05 OKLab or more apart.
console.log("\nHeatmap ramps: OKLab distance from the previous step (flat -> 1 -> 2 -> 3 -> 4)");
for (const theme of THEMES) {
  for (const convention of CONVENTIONS) {
    const tokens = resolveTokens(sources, theme, convention);
    const color = (name: string) => parseColor(tokens.get(`--${name}`) ?? "")!;
    for (const side of ["up", "down"] as const) {
      const steps = ["heat-flat", ...[1, 2, 3, 4].map((n) => `heat-${side}-${n}`)];
      const distances = steps.slice(1).map((step, i) => oklabDistance(color(steps[i]), color(step)).toFixed(3));
      console.log(`  ${theme}/${convention} ${side.padEnd(4)} ${distances.join("  ")}`);
    }
  }
}

const failures = [...results.values()].flat().filter((r) => !r.pass);
console.log(`\n${failures.length === 0 ? "All" : `${CONTRAST_PAIRS.length * scenarios.length - failures.length} of`} ${CONTRAST_PAIRS.length * scenarios.length} checks pass.`);
for (const f of failures) console.log(`  FAIL ${f.theme}/${f.convention}: ${f.fg} on ${f.bg} ${f.ratio.toFixed(2)} < ${f.min} (${f.role})`);
process.exit(failures.length === 0 ? 0 : 1);
