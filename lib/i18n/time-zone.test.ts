import { describe, expect, it } from "vitest";

import { timeZoneLabel } from "./time-zone";

const WINTER = Date.UTC(2026, 0, 15, 12);

describe("timeZoneLabel", () => {
  it("names the zone in Chinese", () => {
    expect(timeZoneLabel("Asia/Shanghai", "zh", WINTER)).toBe("中国标准时间");
    expect(timeZoneLabel("Asia/Tokyo", "zh", WINTER)).toBe("日本标准时间");
  });

  it("keeps the IANA name in English and for a zone the browser does not know", () => {
    expect(timeZoneLabel("Asia/Shanghai", "en", WINTER)).toBe("Asia/Shanghai");
    expect(timeZoneLabel("Mars/Olympus", "zh", WINTER)).toBe("Mars/Olympus");
  });
});
