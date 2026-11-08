import { beforeEach, describe, expect, it, vi } from "vitest";

// The unlock page titles itself through requestMessages (lib/i18n/request.ts), as the other pages do: the language
// cookie first, then Accept-Language. The root layout's template adds " · InvestSeek".

const request = vi.hoisted(() => ({ lang: undefined as string | undefined, acceptLanguage: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "is_lang" && request.lang ? { name, value: request.lang } : undefined) }),
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === "accept-language" ? request.acceptLanguage : null) }),
}));

const { generateMetadata } = await import("./page");

describe("the unlock page", () => {
  beforeEach(() => {
    request.lang = undefined;
    request.acceptLanguage = null;
  });

  it("is titled in the reader's language and kept out of search engines", async () => {
    const robots = { index: false, follow: false };
    request.lang = "zh";
    request.acceptLanguage = "en-US,en;q=0.9";
    expect(await generateMetadata()).toEqual({ title: "解锁", robots });
    request.lang = undefined;
    expect(await generateMetadata()).toEqual({ title: "Unlock", robots });
    request.acceptLanguage = "zh-CN,zh;q=0.9";
    expect(await generateMetadata()).toEqual({ title: "解锁", robots });
  });
});
