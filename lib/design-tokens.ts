// Reads the color tokens in app/globals.css for one theme and price convention, and lists the contrast pairs the design
// system promises (docs/design-system.md). Used by scripts/check-contrast.ts and the token tests; the browser never
// imports this file, it only needs the CSS.

export type ThemeName = "dark" | "light";
export type Convention = "intl" | "cn" | "cb";

export const THEMES: readonly ThemeName[] = ["dark", "light"];
export const CONVENTIONS: readonly Convention[] = ["intl", "cn", "cb"];

export interface CssBlock {
  prelude: string;
  decls: Map<string, string>;
  children: CssBlock[];
}

/**
 * Parses CSS source into nested blocks with their declarations, comments removed. It handles what the token file uses
 * (nested rules, at-rules, custom properties) and is not a general CSS parser: strings containing braces or
 * semicolons are not supported.
 */
export function parseCssBlocks(css: string): CssBlock[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const roots: CssBlock[] = [];
  const stack: CssBlock[] = [];
  let buffer = "";

  const flushDeclaration = () => {
    const statement = buffer.trim();
    buffer = "";
    const current = stack[stack.length - 1];
    if (!current || !statement) return;
    const match = /^(--[\w-]+|[a-z-]+)\s*:\s*([\s\S]+)$/.exec(statement);
    if (match) current.decls.set(match[1], match[2].trim());
  };

  for (const char of src) {
    if (char === "{") {
      const block: CssBlock = { prelude: buffer.trim(), decls: new Map(), children: [] };
      buffer = "";
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(block);
      else roots.push(block);
      stack.push(block);
    } else if (char === ";") {
      flushDeclaration();
    } else if (char === "}") {
      flushDeclaration();
      stack.pop();
    } else {
      buffer += char;
    }
  }
  return roots;
}

export interface TokenSources {
  /** Custom properties declared directly on :root (the dark theme and the default convention). */
  base: Map<string, string>;
  /** Overrides inside `@variant theme-light` (light theme, and system theme on a light OS). */
  light: Map<string, string>;
  /** Overrides on :root[data-updown="cn"] and :root[data-updown="cb"]. */
  conventions: Record<Exclude<Convention, "intl">, Map<string, string>>;
}

function customProps(decls: Map<string, string>): Array<[string, string]> {
  return [...decls].filter(([name]) => name.startsWith("--"));
}

/** Collects the token declarations of app/globals.css by the selector they live under. */
export function extractTokenSources(css: string): TokenSources {
  const sources: TokenSources = { base: new Map(), light: new Map(), conventions: { cn: new Map(), cb: new Map() } };
  const visit = (blocks: CssBlock[]) => {
    for (const block of blocks) {
      const prelude = block.prelude.replace(/\s+/g, " ");
      if (prelude === ":root") {
        for (const [name, value] of customProps(block.decls)) sources.base.set(name, value);
        for (const child of block.children) {
          if (child.prelude.trim() === "@variant theme-light") {
            for (const [name, value] of customProps(child.decls)) sources.light.set(name, value);
          }
        }
      } else {
        const convention = /^:root\[data-updown="(cn|cb)"\]$/.exec(prelude);
        if (convention) {
          const target = sources.conventions[convention[1] as "cn" | "cb"];
          for (const [name, value] of customProps(block.decls)) target.set(name, value);
        } else {
          visit(block.children);
        }
      }
    }
  };
  visit(parseCssBlocks(css));
  return sources;
}

/** Resolves every token to its final value (var() references substituted) for one theme and convention. */
export function resolveTokens(sources: TokenSources, theme: ThemeName, convention: Convention): Map<string, string> {
  const raw = new Map(sources.base);
  if (theme === "light") for (const [name, value] of sources.light) raw.set(name, value);
  if (convention !== "intl") for (const [name, value] of sources.conventions[convention]) raw.set(name, value);

  const resolved = new Map<string, string>();
  const resolve = (name: string, seen: Set<string>): string => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    if (seen.has(name)) throw new Error(`Token cycle at ${name}`);
    const value = raw.get(name);
    if (value === undefined) throw new Error(`Unknown token ${name}`);
    seen.add(name);
    const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_match, ref: string, fallback?: string) =>
      raw.has(ref) ? resolve(ref, seen) : (fallback ?? "").trim(),
    );
    seen.delete(name);
    resolved.set(name, out);
    return out;
  };
  for (const name of raw.keys()) resolve(name, new Set());
  return resolved;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses #rgb, #rrggbb, rgb(r g b / a) and rgb(r, g, b) / rgba(r, g, b, a). Returns null for anything else. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (part: string) => (part.endsWith("%") ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part));
  const alphaPart = parts[3];
  const a = alphaPart === undefined ? 1 : alphaPart.endsWith("%") ? Number.parseFloat(alphaPart) / 100 : Number.parseFloat(alphaPart);
  const [r, g, b] = parts.slice(0, 3).map(channel);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r, g, b, a };
}

/** Alpha-composites a (possibly translucent) color over an opaque one. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of an opaque color. */
export function relativeLuminance(color: Rgba): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG 2 contrast ratio (1 to 21). A translucent foreground is composited over the background first. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const bg = background.a < 1 ? composite(background, { r: 0, g: 0, b: 0, a: 1 }) : background;
  const fg = foreground.a < 1 ? composite(foreground, bg) : foreground;
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Euclidean distance in OKLab, as used for "can these two fills be told apart" checks (0.02 is barely visible). */
export function oklabDistance(a: Rgba, b: Rgba): number {
  const lab = (c: Rgba) => {
    const [r, g, bl] = [linear(c.r), linear(c.g), linear(c.b)];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export interface ContrastPair {
  /** Token names without the leading "--". */
  fg: string;
  /**
   * Opacity the foreground is drawn at, 0 to 1 (Tailwind's /85 modifier is 0.85): it is composited over the background,
   * as the browser paints it. Omitted means opaque.
   */
  fgAlpha?: number;
  bg: string;
  /** Opacity the background is drawn at over `over` (a bg-fg/85 fill on the panel). Needs `over`. */
  bgAlpha?: number;
  /** Composite a translucent background over this token first (e.g. accent-soft over the panel). */
  over?: string;
  /** 4.5 for text, 3 for large text and non-text marks (WCAG 1.4.3 and 1.4.11). */
  min: number;
  role: string;
}

const text = (fg: string, bg: string, role: string, over?: string): ContrastPair => ({ fg, bg, over, min: 4.5, role });
const mark = (fg: string, bg: string, role: string, fgAlpha?: number): ContrastPair => ({ fg, fgAlpha, bg, min: 3, role });

/** Every pairing the components rely on, checked in both themes and all three conventions. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...["panel", "panel-2", "hover"].flatMap((bg) => [
    text("fg", bg, bg === "panel" ? "Values and titles; the strong buy rating shade (bg-fg)" : "Values and titles"),
    text("fg-2", bg, "Secondary text"),
    text("fg-3", bg, "Labels, column heads, meta, disabled buttons"),
    text("up", bg, "Price and P&L up"),
    text("down", bg, "Price and P&L down"),
  ]),
  text("fg-2", "canvas", "Text on the bare canvas (404 page); --fg-3 is for panels only"),
  text("fg", "input-bg", "Text typed into a field"),
  text("fg-3", "input-bg", "Placeholders in fields and the command button"),
  text("accent", "panel", "Links and the current marker label"),
  text("accent", "panel-2", "Function code chip in a panel header"),
  text("accent", "hover", "Ticker links on a hovered row, toast action on hover"),
  text("accent", "accent-soft", "Active icon button", "panel"),
  text("accent", "accent-soft", "Accent badge in a panel header", "panel-2"),
  text("accent", "accent-soft", "Accent badge on a hovered row", "hover"),
  text("accent-fg", "accent", "Primary button"),
  text("info", "panel", "Links, info badges"),
  text("info", "panel-2", "Info badge in a panel header (a statement currency)"),
  text("warn", "panel", "Warnings"),
  text("warn", "panel-2", "Stale data banner"),
  text("warn", "hover", "Caveats and near dates on a hovered row: overdue reviews, alerts that cannot be checked, earnings within 7 days"),
  text("danger", "panel", "Errors"),
  text("heat-fg", "heat-flat", "Heatmap tile, flat"),
  ...[1, 2, 3].flatMap((step) => [text("heat-fg", `heat-up-${step}`, `Heatmap tile, up step ${step}`), text("heat-fg", `heat-down-${step}`, `Heatmap tile, down step ${step}`)]),
  text("heat-fg-strong", "heat-up-4", "Heatmap tile, up step 4"),
  text("heat-fg-strong", "heat-down-4", "Heatmap tile, down step 4"),
  mark("input-border", "panel", "Input and command button boundary"),
  mark("input-border", "panel-2", "Input boundary in a header or toolbar"),
  mark("accent", "canvas", "Focus ring on the canvas"),
  mark("spark", "panel", "Sparkline stroke"),
  mark("fg-3", "line-2", "Meter fill on its track"),
  mark("accent", "line-2", "Current marker on a track"),
  mark("info", "line-2", "Share-of-risk bar on its track"),
  mark("fg", "line-2", "52-week position marker on its range track (heatmap card)"),
  mark("fg", "canvas", "Heatmap tile hover and keyboard ring, drawn inside a canvas halo"),
  ...[1, 2, 3, 4, 5, 6].map((n) => mark(`series-${n}`, "panel", `Chart series ${n}`)),
  // The analyst rating shades (RATING_SHADES in components/calendar/earnings-model.ts) as fills on the panel: rating
  // bar segments and legend swatches. The opaque strong buy shade is "fg on panel" above. No text is drawn on a shade:
  // the legend sets each label beside its swatch.
  mark("fg", "panel", "Rating shade, buy (bg-fg/85)", 0.85),
  mark("fg", "panel", "Rating shade, hold (bg-fg/72)", 0.72),
  mark("fg", "panel", "Rating shade, sell (bg-fg/60)", 0.6),
  mark("fg", "panel", "Rating shade, strong sell (bg-fg/50)", 0.5),
];

/** A token as a Tailwind class names it: "fg", or "fg/85" when it is drawn at 85% opacity. */
function tokenAt(token: string, alpha: number | undefined): string {
  return alpha === undefined || alpha === 1 ? token : `${token}/${Math.round(alpha * 1000) / 10}`;
}

/**
 * The colors a pair measures, e.g. "accent on accent-soft over panel-2" or "fg/60 on panel". The role and the minimum
 * are not part of it.
 */
export function pairName(pair: Pick<ContrastPair, "fg" | "fgAlpha" | "bg" | "bgAlpha" | "over">): string {
  const bg = tokenAt(pair.bg, pair.bgAlpha);
  return `${tokenAt(pair.fg, pair.fgAlpha)} on ${pair.over ? `${bg} over ${pair.over}` : bg}`;
}

/**
 * Pairs that measure the same colors more than once (a merge that kept two roles for one pair). Merge the roles into
 * one entry instead: a second copy adds checks without adding coverage.
 */
export function duplicatePairs(pairs: readonly ContrastPair[] = CONTRAST_PAIRS): string[] {
  const counts = new Map<string, number>();
  for (const pair of pairs) counts.set(pairName(pair), (counts.get(pairName(pair)) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([name]) => name);
}

export interface ContrastResult extends ContrastPair {
  theme: ThemeName;
  convention: Convention;
  ratio: number;
  pass: boolean;
}

/**
 * Checks every pair in one theme and convention. A color with an opacity (fgAlpha, bgAlpha) is composited at that
 * opacity over the surface under it in this theme. Throws when a token is missing or not a parseable color, when an
 * opacity is outside 0 to 1, and when a translucent background has no surface (over).
 */
export function checkContrast(tokens: Map<string, string>, theme: ThemeName, convention: Convention, pairs = CONTRAST_PAIRS): ContrastResult[] {
  const color = (name: string, alpha = 1): Rgba => {
    const value = tokens.get(`--${name}`);
    const parsed = value === undefined ? null : parseColor(value);
    if (!parsed) throw new Error(`--${name} is not a color in ${theme}/${convention}: ${value}`);
    if (!(alpha >= 0 && alpha <= 1)) throw new Error(`Opacity ${alpha} of --${name} is outside 0 to 1`);
    return { ...parsed, a: parsed.a * alpha };
  };
  return pairs.map((pair) => {
    if (pair.bgAlpha !== undefined && pair.bgAlpha < 1 && !pair.over) throw new Error(`${pairName(pair)}: a translucent background needs the surface under it (over)`);
    const background = pair.over ? composite(color(pair.bg, pair.bgAlpha), color(pair.over)) : color(pair.bg);
    const ratio = contrastRatio(color(pair.fg, pair.fgAlpha), background);
    return { ...pair, theme, convention, ratio, pass: ratio >= pair.min };
  });
}
