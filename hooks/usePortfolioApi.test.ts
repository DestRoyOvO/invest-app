import { describe, expect, it } from "vitest";

import { profilesKey } from "./usePortfolioApi";

describe("profilesKey", () => {
  it("asks for each symbol once, in a stable order", () => {
    expect(profilesKey(["SHOP", "PLTR", "SHOP"])).toBe("/api/profiles?symbols=PLTR,SHOP");
    expect(profilesKey(["PLTR", "SHOP"])).toBe(profilesKey(["SHOP", "PLTR"]));
  });

  it("skips the request without symbols and caps the list at the route limit", () => {
    expect(profilesKey([])).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => `S${String(i).padStart(2, "0")}`);
    expect(profilesKey(many)?.split("=")[1].split(",")).toHaveLength(25);
    expect(profilesKey(["BRK-B", "^GSPC"])).toBe("/api/profiles?symbols=BRK-B,%5EGSPC");
  });
});
