import { describe, expect, it } from "vitest";

import { rovingIndex } from "./keys";

describe("rovingIndex", () => {
  it("wraps horizontally", () => {
    expect(rovingIndex("ArrowRight", 0, 3)).toBe(1);
    expect(rovingIndex("ArrowRight", 2, 3)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("jumps with Home and End", () => {
    expect(rovingIndex("Home", 2, 4)).toBe(0);
    expect(rovingIndex("End", 0, 4)).toBe(3);
  });

  it("follows the orientation", () => {
    expect(rovingIndex("ArrowDown", 0, 3)).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 3, "vertical")).toBe(1);
    expect(rovingIndex("ArrowUp", 0, 3, "both")).toBe(2);
    expect(rovingIndex("ArrowRight", 1, 3, "both")).toBe(2);
  });

  it("ignores other keys and empty groups", () => {
    expect(rovingIndex("Enter", 0, 3)).toBeNull();
    expect(rovingIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
