import { beforeEach, describe, expect, it, vi } from "vitest";

const request = { lang: undefined as string | undefined, acceptLanguage: null as string | null };

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "is_lang" && request.lang ? { name, value: request.lang } : undefined) }),
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === "accept-language" ? request.acceptLanguage : null) }),
}));

const { requestLang, requestMessages } = await import("./request");

describe("the reader's language on the server", () => {
  beforeEach(() => {
    request.lang = undefined;
    request.acceptLanguage = null;
  });

  it("follows the language cookie first", async () => {
    request.lang = "zh";
    request.acceptLanguage = "en-US,en;q=0.9";
    expect(await requestLang()).toBe("zh");
  });

  it("falls back to Accept-Language, then English", async () => {
    request.acceptLanguage = "zh-CN,zh;q=0.9,en;q=0.5";
    expect(await requestLang()).toBe("zh");
    request.acceptLanguage = null;
    expect(await requestLang()).toBe("en");
  });

  it("ignores an unknown cookie value", async () => {
    request.lang = "fr";
    expect(await requestLang()).toBe("en");
  });

  it("gives the messages of that language for page titles", async () => {
    request.lang = "zh";
    const { lang, t } = await requestMessages();
    expect(lang).toBe("zh");
    expect(t.alerts.title).toBe("提醒");
    expect(t.meta.title).toBe("InvestSeek · 行情终端");
  });
});
