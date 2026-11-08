import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activeOutlet, addOutlet, carryOver, createToastStore, pushToast, remainingTime, removeOutlet, removeToast } from "./toast-queue";

describe("toast queue", () => {
  it("appends and keeps the newest ones", () => {
    let queue = pushToast([], { id: "a" }, 3);
    queue = pushToast(queue, { id: "b" }, 3);
    queue = pushToast(queue, { id: "c" }, 3);
    queue = pushToast(queue, { id: "d" }, 3);
    expect(queue.map((t) => t.id)).toEqual(["b", "c", "d"]);
  });

  it("replaces a toast with the same id and moves it to the end", () => {
    const queue = pushToast([{ id: "a", n: 1 }, { id: "b", n: 1 }], { id: "a", n: 2 }, 3);
    expect(queue).toEqual([
      { id: "b", n: 1 },
      { id: "a", n: 2 },
    ]);
  });

  it("removes by id and ignores unknown ids", () => {
    expect(removeToast([{ id: "a" }, { id: "b" }], "a")).toEqual([{ id: "b" }]);
    expect(removeToast([{ id: "a" }], "x")).toEqual([{ id: "a" }]);
  });

  it("never resumes with less than the floor", () => {
    expect(remainingTime(10_000, 4_000)).toBe(6_000);
    expect(remainingTime(10_000, 9_900)).toBe(1_500);
    expect(remainingTime(10_000, 12_000, 2_000)).toBe(2_000);
  });
});

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(max = 3) {
    const lists: string[][] = [];
    const store = createToastStore<{ id: string; duration: number }>((toasts) => lists.push(toasts.map((t) => t.id)), { max });
    const ids = () => store.toasts().map((t) => t.id);
    return { store, lists, ids };
  }

  it("publishes each change and closes each toast after its duration", () => {
    const { store, lists, ids } = setup();
    store.show({ id: "a", duration: 1000 });
    store.show({ id: "b", duration: 3000 });
    expect(lists).toEqual([["a"], ["a", "b"]]);
    vi.advanceTimersByTime(999);
    expect(ids()).toEqual(["a", "b"]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual(["b"]);
    vi.advanceTimersByTime(5000);
    expect(lists.at(-1)).toEqual([]);
  });

  it("keeps the countdown of every toast shown in a burst and drops the ones pushed out", () => {
    const { store, lists, ids } = setup(3);
    for (const id of ["1", "2", "3", "4"]) store.show({ id, duration: 1500 });
    expect(ids()).toEqual(["2", "3", "4"]);
    vi.advanceTimersByTime(1500);
    expect(ids()).toEqual([]);
    // The toast that was pushed out has no countdown left, so no extra list is published for it.
    expect(lists).toHaveLength(4 + 3);
  });

  it("restarts a toast shown again with the same id", () => {
    const { store, ids } = setup();
    store.show({ id: "a", duration: 1000 });
    vi.advanceTimersByTime(800);
    store.show({ id: "a", duration: 1000 });
    vi.advanceTimersByTime(800);
    expect(ids()).toEqual(["a"]);
    vi.advanceTimersByTime(200);
    expect(ids()).toEqual([]);
  });

  it("dismisses at once and ignores unknown ids", () => {
    const { store, lists, ids } = setup();
    store.show({ id: "a", duration: 1000 });
    store.dismiss("a");
    store.dismiss("nope");
    expect(ids()).toEqual([]);
    expect(lists).toEqual([["a"], []]);
    vi.advanceTimersByTime(5000);
    expect(lists).toHaveLength(2);
  });

  it("pauses while held and resumes with the time that was left", () => {
    const { store, ids } = setup();
    store.show({ id: "a", duration: 5000 });
    vi.advanceTimersByTime(2000);
    store.hold("hover", true);
    vi.advanceTimersByTime(60_000);
    expect(ids()).toEqual(["a"]);
    store.hold("hover", false);
    vi.advanceTimersByTime(2999);
    expect(ids()).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });

  it("gives a toast that was about to close at least the floor after a pause", () => {
    const { store, ids } = setup();
    store.show({ id: "a", duration: 5000 });
    vi.advanceTimersByTime(4900);
    store.hold("focus", true);
    store.hold("focus", false);
    vi.advanceTimersByTime(1499);
    expect(ids()).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });

  it("stays paused until neither hover nor focus holds", () => {
    const { store, ids } = setup();
    store.show({ id: "a", duration: 1000 });
    store.hold("hover", true);
    store.hold("focus", true);
    store.hold("hover", false);
    expect(store.isHeld()).toBe(true);
    expect(store.isHeld("focus")).toBe(true);
    expect(store.isHeld("hover")).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(ids()).toEqual(["a"]);
    store.hold("focus", false);
    expect(store.isHeld()).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(ids()).toEqual([]);
  });

  it("gives a toast shown during a pause its full duration once the pause ends", () => {
    const { store, ids } = setup();
    store.hold("focus", true);
    store.show({ id: "later", duration: 3000 });
    vi.advanceTimersByTime(10_000);
    expect(ids()).toEqual(["later"]);
    store.hold("focus", false);
    vi.advanceTimersByTime(2999);
    expect(ids()).toEqual(["later"]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });

  it("ignores a hold that is released twice or set twice", () => {
    const { store, ids } = setup();
    store.show({ id: "a", duration: 2000 });
    store.hold("hover", false);
    store.hold("focus", true);
    store.hold("focus", true);
    vi.advanceTimersByTime(1000);
    store.hold("focus", false);
    store.hold("focus", false);
    vi.advanceTimersByTime(1999);
    expect(ids()).toEqual(["a"]);
    vi.advanceTimersByTime(1);
    expect(ids()).toEqual([]);
  });

  it("clears every countdown and hold but leaves the toasts", () => {
    const { store, ids } = setup();
    store.show({ id: "a", duration: 1000 });
    store.hold("hover", true);
    store.clear();
    expect(store.isHeld()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(ids()).toEqual(["a"]);
  });
});

describe("toast outlets", () => {
  it("hand the toasts to the newest outlet, and back to the one below or the screen's edge as outlets go", () => {
    let outlets: readonly string[] = [];
    expect(activeOutlet(outlets)).toBeNull();
    outlets = addOutlet(outlets, "chat");
    outlets = addOutlet(outlets, "alert editor");
    expect(activeOutlet(outlets)).toBe("alert editor");
    outlets = removeOutlet(outlets, "alert editor");
    expect(activeOutlet(outlets)).toBe("chat");
    outlets = removeOutlet(outlets, "chat");
    expect(activeOutlet(outlets)).toBeNull();
  });

  it("move an outlet registered again to the top, once", () => {
    const outlets = addOutlet(addOutlet(addOutlet([], "a"), "b"), "a");
    expect(outlets).toEqual(["b", "a"]);
    expect(activeOutlet(outlets)).toBe("a");
  });

  it("keep the same list when an unknown outlet goes, so React skips the render", () => {
    const outlets = addOutlet([], "a");
    expect(removeOutlet(outlets, "b")).toBe(outlets);
    // The closing drawer is removed before or after the opening one registers: the result is the same.
    expect(removeOutlet(addOutlet(outlets, "b"), "a")).toEqual(addOutlet(removeOutlet(outlets, "a"), "b"));
  });
});

describe("toasts carried to another host", () => {
  const saved = { id: "saved" };
  const triggered = { id: "triggered" };
  const confirmation = { id: "confirmation" };

  it("are the ones a live region has shown, so a drawer opening or closing does not announce them again", () => {
    const announced = new Set([saved, triggered]);
    expect([...carryOver([saved, triggered], (toast) => announced.has(toast), new Set())]).toEqual([saved, triggered]);
  });

  it("leave out a toast shown as the drawer closes, which its new host announces", () => {
    const announced = new Set([saved]);
    const carried = carryOver([saved, confirmation], (toast) => announced.has(toast), new Set());
    expect(carried.has(saved)).toBe(true);
    expect(carried.has(confirmation)).toBe(false);
  });

  it("stay carried through later moves and drop out once closed", () => {
    const first = carryOver([saved, triggered], () => true, new Set());
    // Back at the screen's edge after Cancel: still carried, though no live region shows them now.
    const second = carryOver([saved, triggered], () => false, first);
    expect([...second]).toEqual([saved, triggered]);
    expect([...carryOver([triggered], () => false, second)]).toEqual([triggered]);
  });

  it("do not include the same toast shown again, which is a new entry", () => {
    const again = { id: "saved" };
    const carried = carryOver([again], () => false, new Set([saved]));
    expect(carried.size).toBe(0);
  });
});
