// User display preferences, persisted in cookies so the server can render the right
// <html lang>, theme and up/down colors on the first paint (no flash).

import type { Lang } from "@/types/api";

export type Theme = "dark" | "light";
/** intl = green up / red down; cn = red up / green down (Chinese market convention). */
export type UpDown = "intl" | "cn";

export interface Prefs {
  lang: Lang;
  theme: Theme;
  updown: UpDown;
}

export const PREF_COOKIES = {
  lang: "is_lang",
  theme: "is_theme",
  updown: "is_updown",
} as const;

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

/** Resolves preferences from cookies, falling back to the Accept-Language header. */
export function resolvePrefs(cookie: (name: string) => string | undefined, acceptLanguage: string | null): Prefs {
  const lang = pick(cookie(PREF_COOKIES.lang), ["en", "zh"] as const) ?? languageFromHeader(acceptLanguage);
  const theme = pick(cookie(PREF_COOKIES.theme), ["dark", "light"] as const) ?? "dark";
  const updown = pick(cookie(PREF_COOKIES.updown), ["intl", "cn"] as const) ?? (lang === "zh" ? "cn" : "intl");
  return { lang, theme, updown };
}

export function htmlLang(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}
