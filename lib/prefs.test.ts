import { describe, expect, it } from "vitest";

import { languageFromHeader, resolvePrefs } from "./prefs";

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
  it("prefers cookies and derives the color convention from the language only as a default", () => {
    const none = () => undefined;
    expect(resolvePrefs(none, "en-US,en;q=0.9,zh;q=0.8")).toEqual({ lang: "en", theme: "dark", updown: "intl" });
    expect(resolvePrefs(none, "zh-CN")).toEqual({ lang: "zh", theme: "dark", updown: "cn" });
    const cookies: Record<string, string> = { is_lang: "en", is_theme: "light", is_updown: "cn" };
    expect(resolvePrefs((name) => cookies[name], "zh-CN")).toEqual({ lang: "en", theme: "light", updown: "cn" });
  });
});
