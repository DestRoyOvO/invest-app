import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-rendered tab titles of the pages that title themselves through requestMessages (lib/i18n/request.ts): the
// language cookie first, then Accept-Language. The root layout's template adds " · InvestSeek".

const request = vi.hoisted(() => ({ lang: undefined as string | undefined, acceptLanguage: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "is_lang" && request.lang ? { name, value: request.lang } : undefined) }),
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === "accept-language" ? request.acceptLanguage : null) }),
}));

const pages = {
  "app/not-found.tsx": await import("./not-found"),
  "app/(terminal)/help/page.tsx": await import("./(terminal)/help/page"),
  "app/(terminal)/data/page.tsx": await import("./(terminal)/data/page"),
};

const EXPECTED: Record<keyof typeof pages, { en: string; zh: string }> = {
  "app/not-found.tsx": { en: "Not found", zh: "未找到页面" },
  "app/(terminal)/help/page.tsx": { en: "Help", zh: "帮助" },
  "app/(terminal)/data/page.tsx": { en: "Your data", zh: "我的数据" },
};

describe("server-rendered page titles", () => {
  beforeEach(() => {
    request.lang = undefined;
    request.acceptLanguage = null;
  });

  for (const [file, page] of Object.entries(pages) as Array<[keyof typeof pages, (typeof pages)[keyof typeof pages]]>) {
    it(`titles ${file} in the reader's language`, async () => {
      request.lang = "zh";
      request.acceptLanguage = "en-US,en;q=0.9";
      expect(await page.generateMetadata()).toEqual({ title: EXPECTED[file].zh });
      request.lang = undefined;
      expect(await page.generateMetadata()).toEqual({ title: EXPECTED[file].en });
      request.acceptLanguage = "zh-CN,zh;q=0.9";
      expect(await page.generateMetadata()).toEqual({ title: EXPECTED[file].zh });
    });
  }
});
