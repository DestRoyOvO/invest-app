import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractArticleText, MAX_ARTICLE_CHARS } from "../article";

import { FIXTURE_NEWS_PREFIX, fixtureArticleText } from "./article";

describe("fixtureArticleText", () => {
  it("answers fixture story links with the same readable text every time", () => {
    const link = `${FIXTURE_NEWS_PREFIX}0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e`;
    const text = fixtureArticleText(link);
    expect(text).toBe(fixtureArticleText(link));
    expect(text?.length).toBeGreaterThan(200);
    expect(text?.length).toBeLessThan(MAX_ARTICLE_CHARS);
    expect(text).toContain("synthetic fixture text");
    // Long enough to pass the reader's own minimum when it comes from a page.
    expect(extractArticleText(`<article>${text!.split("\n\n").map((p) => `<p>${p}</p>`).join("")}</article>`)).not.toBeNull();
  });

  it("treats every other link as unavailable", () => {
    for (const link of ["https://www.reuters.com/markets/story", "https://example.com/other/123456789", `${FIXTURE_NEWS_PREFIX}../../etc`, "not a url"]) {
      expect(fixtureArticleText(link), link).toBeNull();
    }
  });
});
