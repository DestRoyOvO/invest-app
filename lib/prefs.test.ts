import { describe, expect, it } from "vitest";

import { THEME_COLORS } from "@/components/ui/brand";

import { htmlAttributes, languageFromHeader, prefCookie, PREF_COOKIE_MAX_AGE, PREF_COOKIES, resolvePrefs, themeColorMetas } from "./prefs";

describe("languageFromHeader", () => {
  it("picks the preferred of English and Chinese", () => {
    expect(languageFromHeader("en-US,en;q=0.9,zh-CN;q=0.8")).toBe("en");
    expect(languageFromHeader("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(languageFromHeader("fr-FR,zh;q=0.7,en;q=0.5")).toBe("zh");
    expect(languageFromHeader("en;q=0.4,zh-TW;q=0.6")).toBe("zh");
    expect(languageFromHeader("fr-FR")).toBe("en");
    expect(languageFromHeader("zh;q=0,en;q=0.1")).toBe("en");
    expect(languageFromHeader("")).toBe("en");
    expect(languageFromHeader(null)).toBe("en");
  });
});

describe("resolvePrefs", () => {
  const none = () => undefined;

  it("follows the system theme, the language's price colors and the comfortable density for new visitors", () => {
    expect(resolvePrefs(none, "en-US,en;q=0.9,zh;q=0.8")).toEqual({ lang: "en", theme: "system", updown: "intl", density: "comfortable" });
    expect(resolvePrefs(none, "zh-CN")).toEqual({ lang: "zh", theme: "system", updown: "cn", density: "comfortable" });
  });

  it("prefers the cookies, including the color-blind convention and the compact density", () => {
    const cookies: Record<string, string> = { is_lang: "en", is_theme: "light", is_updown: "cb", is_density: "compact" };
    expect(resolvePrefs((name) => cookies[name], "zh-CN")).toEqual({ lang: "en", theme: "light", updown: "cb", density: "compact" });
    const dark: Record<string, string> = { is_theme: "dark", is_updown: "cn" };
    expect(resolvePrefs((name) => dark[name], "en")).toEqual({ lang: "en", theme: "dark", updown: "cn", density: "comfortable" });
    const system: Record<string, string> = { is_theme: "system" };
    expect(resolvePrefs((name) => system[name], "en").theme).toBe("system");
  });

  it("ignores unknown cookie values", () => {
    const bad: Record<string, string> = { is_lang: "fr", is_theme: "neon", is_updown: "purple", is_density: "tiny" };
    expect(resolvePrefs((name) => bad[name], "zh-CN")).toEqual({ lang: "zh", theme: "system", updown: "cn", density: "comfortable" });
  });
});

describe("prefCookie", () => {
  it("writes one year, site-wide, lax cookies under the documented names", () => {
    expect(PREF_COOKIES).toEqual({ lang: "is_lang", theme: "is_theme", updown: "is_updown", density: "is_density" });
    expect(prefCookie("density", "compact")).toBe(`is_density=compact; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`);
    expect(prefCookie("theme", "system")).toBe(`is_theme=system; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`);
    expect(prefCookie("updown", "cb")).toMatch(/^is_updown=cb;/);
    expect(PREF_COOKIE_MAX_AGE).toBe(31_536_000);
  });

  it("round-trips through resolvePrefs", () => {
    const jar = new Map<string, string>();
    for (const cookie of [prefCookie("lang", "zh"), prefCookie("theme", "dark"), prefCookie("updown", "cb"), prefCookie("density", "compact")]) {
      const [pair] = cookie.split(";");
      const [name, value] = pair.split("=");
      jar.set(name, decodeURIComponent(value));
    }
    expect(resolvePrefs((name) => jar.get(name), null)).toEqual({ lang: "zh", theme: "dark", updown: "cb", density: "compact" });
  });
});

describe("htmlAttributes", () => {
  it("renders lang and the three switches", () => {
    expect(htmlAttributes({ lang: "zh", theme: "system", updown: "cb", density: "compact" })).toEqual({
      lang: "zh-CN",
      "data-theme": "system",
      "data-updown": "cb",
      "data-density": "compact",
    });
    expect(htmlAttributes({ lang: "en", theme: "dark", updown: "intl", density: "comfortable" }).lang).toBe("en");
  });
});

describe("themeColorMetas", () => {
  it("uses one canvas color for an explicit theme and one per color scheme for System", () => {
    expect(themeColorMetas("dark")).toEqual([{ color: THEME_COLORS.dark, media: null }]);
    expect(themeColorMetas("light")).toEqual([{ color: THEME_COLORS.light, media: null }]);
    expect(themeColorMetas("system")).toEqual([
      { color: THEME_COLORS.dark, media: "(prefers-color-scheme: dark)" },
      { color: THEME_COLORS.light, media: "(prefers-color-scheme: light)" },
    ]);
  });
});
