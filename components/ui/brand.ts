// The InvestSeek mark ("prompt-candle": a command-line chevron followed by a candlestick) and the brand colors used
// where the theme tokens do not exist: the favicon, the home-screen icon and the social card.

/** Brand colors, the same in both themes (they match the dark theme's canvas, accent and text). */
export const BRAND_COLORS = {
  background: "#06080b",
  glyph: "#f2a33a",
  text: "#e6e9ed",
  muted: "#a9b2be",
} as const;

/** Canvas colors of the two themes, for the browser's theme-color. */
export const THEME_COLORS = { dark: "#06080b", light: "#e4e8ed" } as const;

/**
 * theme-color for the browser bar: the canvas of an explicit theme, or both canvases by media query for a theme that
 * follows the system (or one this code does not know).
 */
export function themeColorFor(theme: string): string | Array<{ media: string; color: string }> {
  if (theme === "dark" || theme === "light") return THEME_COLORS[theme];
  return [
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
  ];
}

/**
 * The dark theme's heatmap steps in the international convention, from down step 4 through flat to up step 4. Copied
 * from app/globals.css for images rendered outside the page; brand.test.ts keeps the two in sync.
 */
export const BRAND_HEAT = ["#f0525a", "#a3343c", "#7c2b31", "#5b2328", "#262c33", "#18492e", "#1b603a", "#1b7243", "#2fbf71"] as const;

/** Geometry of the mark on a 24-unit grid. app/icon.svg is generated from it (see brand.test.ts). */
export const MARK = {
  size: 24,
  chevron: { points: "4.5,6 10.5,12 4.5,18", strokeWidth: 3 },
  wick: { x: 18, y1: 3.5, y2: 20.5, strokeWidth: 2 },
  body: { x: 15, y: 7.5, width: 6, height: 8 },
} as const;

interface MarkSvgOptions {
  /** Output size in pixels (the SVG is square). */
  size: number;
  color?: string;
  /** Background fill; omit for a transparent mark. */
  background?: string;
  /** Corner radius of the background, in output pixels. */
  radius?: number;
  /** Space around the 24-unit glyph, in output pixels. */
  padding?: number;
}

/** The mark as standalone SVG markup, e.g. for app/icon.svg or a data URI. */
export function markSvg({ size, color = BRAND_COLORS.glyph, background, radius = 0, padding = 0 }: MarkSvgOptions): string {
  const scale = Math.round(((size - padding * 2) / MARK.size) * 10000) / 10000;
  const { chevron, wick, body } = MARK;
  const backdrop = background ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    backdrop,
    `<g transform="translate(${padding} ${padding}) scale(${scale})">`,
    `<polyline points="${chevron.points}" fill="none" stroke="${color}" stroke-width="${chevron.strokeWidth}" stroke-linecap="butt" stroke-linejoin="miter"/>`,
    `<line x1="${wick.x}" y1="${wick.y1}" x2="${wick.x}" y2="${wick.y2}" stroke="${color}" stroke-width="${wick.strokeWidth}"/>`,
    `<rect x="${body.x}" y="${body.y}" width="${body.width}" height="${body.height}" fill="${color}"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
}
