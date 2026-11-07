import { describe, expect, it } from "vitest";

import { matchesHotkey } from "./useHotkeys";

const key = (k: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, ...mods });

describe("matchesHotkey", () => {
  it("matches letters case-insensitively and named keys exactly", () => {
    expect(matchesHotkey(key("A"), { key: "a" })).toBe(true);
    expect(matchesHotkey(key("a"), { key: "A" })).toBe(true);
    expect(matchesHotkey(key("ArrowDown"), { key: "ArrowDown" })).toBe(true);
    expect(matchesHotkey(key("ArrowDown"), { key: "arrowdown" })).toBe(false);
    expect(matchesHotkey(key("?"), { key: "?" })).toBe(true);
  });

  it("never fires with Ctrl or Cmd, and requires Alt only when asked", () => {
    expect(matchesHotkey(key("a", { ctrlKey: true }), { key: "a" })).toBe(false);
    expect(matchesHotkey(key("a", { metaKey: true }), { key: "a" })).toBe(false);
    expect(matchesHotkey(key("ArrowUp", { altKey: true }), { key: "ArrowUp" })).toBe(false);
    expect(matchesHotkey(key("ArrowUp", { altKey: true }), { key: "ArrowUp", alt: true })).toBe(true);
    expect(matchesHotkey(key("ArrowUp"), { key: "ArrowUp", alt: true })).toBe(false);
  });
});
