import { describe, expect, it } from "vitest";

import { parseSiteUrl } from "./site";

describe("parseSiteUrl", () => {
  it("accepts http and https origins", () => {
    expect(parseSiteUrl("https://investseek.example")?.origin).toBe("https://investseek.example");
    expect(parseSiteUrl("  http://localhost:3000/ ")?.origin).toBe("http://localhost:3000");
  });

  it("ignores empty, invalid and non-web values", () => {
    expect(parseSiteUrl(undefined)).toBeUndefined();
    expect(parseSiteUrl("")).toBeUndefined();
    expect(parseSiteUrl("investseek.example")).toBeUndefined();
    expect(parseSiteUrl("javascript:alert(1)")).toBeUndefined();
    expect(parseSiteUrl("ftp://files.example")).toBeUndefined();
  });
});
