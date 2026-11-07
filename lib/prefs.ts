// User display preferences, persisted in cookies so the server can render the right <html lang>, theme, price colors
// and density on the first paint (no flash). PrefsProvider writes the same cookies and attributes at runtime.

import { themeColorFor } from "@/components/ui/brand";
import type { Lang } from "@/types/api";

/** system follows prefers-color-scheme in pure CSS (app/globals.css). */
export type Theme = "dark" | "light" | "system";
/** intl = green up / red down; cn = red up / green down (Chinese market convention); cb = blue up / orange down. */
export type UpDown = "intl" | "cn" | "cb";
/** compact lowers the table row height and the data text size (app/globals.css, data-density). */
export type Density = "comfortable" | "compact";

export const THEMES: readonly Theme[] = ["dark", "light", "system"];
export const UPDOWNS: readonly UpDown[] = ["intl", "cn", "cb"];
export const DENSITIES: readonly Density[] = ["comfortable", "compact"];

/** New visitors follow the operating system until they pick a theme. */
export const DEFAULT_THEME: Theme = "system";
export const DEFAULT_DENSITY: Density = "comfortable";

export interface Prefs {
  lang: Lang;
  theme: Theme;
  updown: UpDown;
  density: Density;
}

export const PREF_COOKIES = {
  lang: "is_lang",
  theme: "is_theme",
  updown: "is_updown",
  density: "is_density",
} as const satisfies Record<keyof Prefs, string>;

export const PREF_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/** The preferred of English and Chinese in an Accept-Language header, by q-value and then by order; English otherwise. */
export function languageFromHeader(header: string | null): Lang {
  let best: { lang: Lang; q: number } | null = null;
  for (const part of (header ?? "").split(",")) {
    const [tag = "", ...params] = part.split(";").map((piece) => piece.trim());
    const primary = tag.toLowerCase().split("-")[0];
    if (primary !== "en" && primary !== "zh") continue;
    const qParam = params.find((param) => param.toLowerCase().startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!best || q > best.q) best = { lang: primary, q };
  }
  return best?.lang ?? "en";
}

/**
 * Resolves preferences from cookies. Without cookies: the language from the Accept-Language header, the System theme,
 * the price colors of that language (red up in Chinese) and the comfortable density. Unknown cookie values are ignored.
 */
export function resolvePrefs(cookie: (name: string) => string | undefined, acceptLanguage: string | null): Prefs {
  const lang = pick(cookie(PREF_COOKIES.lang), ["en", "zh"] as const) ?? languageFromHeader(acceptLanguage);
  const theme = pick(cookie(PREF_COOKIES.theme), THEMES) ?? DEFAULT_THEME;
  const updown = pick(cookie(PREF_COOKIES.updown), UPDOWNS) ?? (lang === "zh" ? "cn" : "intl");
  const density = pick(cookie(PREF_COOKIES.density), DENSITIES) ?? DEFAULT_DENSITY;
  return { lang, theme, updown, density };
}

/** The document.cookie assignment that stores one preference for a year on the whole site. */
export function prefCookie<K extends keyof Prefs>(key: K, value: Prefs[K]): string {
  return `${PREF_COOKIES[key]}=${encodeURIComponent(value)}; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function htmlLang(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}

/** Attributes the server renders on <html> and PrefsProvider keeps in sync. */
export function htmlAttributes(prefs: Prefs): { lang: string; "data-theme": Theme; "data-updown": UpDown; "data-density": Density } {
  return { lang: htmlLang(prefs.lang), "data-theme": prefs.theme, "data-updown": prefs.updown, "data-density": prefs.density };
}

export interface ThemeColorMeta {
  color: string;
  /** A prefers-color-scheme media query for the System theme; null for an explicit theme. */
  media: string | null;
}

/** The theme-color meta tags for a theme: the canvas color, or one per color scheme when the theme follows the system. */
export function themeColorMetas(theme: Theme): ThemeColorMeta[] {
  const spec = themeColorFor(theme);
  return typeof spec === "string" ? [{ color: spec, media: null }] : spec.map(({ color, media }) => ({ color, media }));
}
