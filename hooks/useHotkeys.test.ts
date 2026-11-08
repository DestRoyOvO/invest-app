import { describe, expect, it, vi } from "vitest";

import { createHotkeyRegistry, hotkeyKeys, hotkeySignature, isComposing, isDialogOpen, matchesHotkey, OPEN_DIALOG_SELECTOR } from "./useHotkeys";

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

describe("isComposing", () => {
  it("detects IME composition, including Safari's keyCode 229", () => {
    expect(isComposing({ isComposing: true, keyCode: 65 })).toBe(true);
    expect(isComposing({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isComposing({ isComposing: false, keyCode: 65 })).toBe(false);
  });
});

describe("isDialogOpen", () => {
  it("counts modal dialogs and popovers such as the settings menu", () => {
    const queried: string[] = [];
    const root = (found: boolean) => ({
      querySelector: (selector: string) => {
        queried.push(selector);
        return found ? ({} as Element) : null;
      },
    });
    expect(isDialogOpen(root(true))).toBe(true);
    expect(isDialogOpen(root(false))).toBe(false);
    expect(queried).toEqual([OPEN_DIALOG_SELECTOR, OPEN_DIALOG_SELECTOR]);
    // The settings menu is role="dialog" without aria-modal; the command bar and drawers are modal.
    expect(OPEN_DIALOG_SELECTOR).toContain('[role="dialog"]');
    expect(OPEN_DIALOG_SELECTOR).toContain('[aria-modal="true"]');
  });
});

describe("createHotkeyRegistry", () => {
  it("lists the hotkeys of mounted components and forgets them on unmount", () => {
    const registry = createHotkeyRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    expect(registry.getSnapshot()).toEqual([]);

    const removeChart = registry.register([
      { key: "[", alt: false, description: "Previous range" },
      { key: "]", alt: false, description: "Next range" },
    ]);
    const removeRows = registry.register([{ key: "ArrowUp", alt: true, description: "Move row up" }]);
    expect(registry.getSnapshot().map((h) => h.description)).toEqual(["Previous range", "Next range", "Move row up"]);
    expect(listener).toHaveBeenCalledTimes(2);

    removeChart();
    expect(registry.getSnapshot().map((h) => h.description)).toEqual(["Move row up"]);
    removeChart();
    expect(listener).toHaveBeenCalledTimes(3);
    removeRows();
    expect(registry.getSnapshot()).toEqual([]);
  });

  it("keeps the first registration of a key, as the key handler does, and tells Alt combinations apart", () => {
    const registry = createHotkeyRegistry();
    registry.register([{ key: "a", alt: false, description: "Add to watchlist" }]);
    registry.register([
      { key: "A", alt: false, description: "Something else" },
      { key: "a", alt: true, description: "Alt A" },
    ]);
    expect(registry.getSnapshot().map((h) => h.description)).toEqual(["Add to watchlist", "Alt A"]);
  });

  it("returns a stable empty snapshot and ignores empty registrations", () => {
    const registry = createHotkeyRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const empty = registry.getSnapshot();
    const remove = registry.register([]);
    remove();
    expect(registry.getSnapshot()).toBe(empty);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("hotkeySignature", () => {
  it("encodes only described hotkeys and changes when a description changes", () => {
    const handler = () => {};
    const en = hotkeySignature([
      { key: "a", description: "Add", handler },
      { key: "x", handler },
    ] as never);
    expect(JSON.parse(en)).toEqual([["a", false, "Add"]]);
    expect(hotkeySignature([{ key: "a", description: "Add" }])).toBe(en);
    expect(hotkeySignature([{ key: "a", description: "添加" }])).not.toBe(en);
    expect(hotkeySignature([{ key: "a", description: "Add", alt: true }])).not.toBe(en);
  });
});

describe("hotkeyKeys", () => {
  it("names keys for key caps", () => {
    expect(hotkeyKeys({ key: "a", alt: false })).toEqual(["A"]);
    expect(hotkeyKeys({ key: "[", alt: false })).toEqual(["["]);
    expect(hotkeyKeys({ key: "ArrowUp", alt: true })).toEqual(["Alt", "↑"]);
    expect(hotkeyKeys({ key: " ", alt: false })).toEqual(["Space"]);
    expect(hotkeyKeys({ key: "Enter", alt: false })).toEqual(["Enter"]);
  });
});
