import { describe, expect, it } from "vitest";

import { pushToast, remainingTime, removeToast } from "./toast-queue";

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
