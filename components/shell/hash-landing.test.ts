import { describe, expect, it } from "vitest";

import { follow, hashId, type FollowEnv } from "./hash-landing";

/** A scrolling area where the target starts `start` px down and moves by `shifts[i]` before frame i (panels loading). */
function fakePage(start: number | null, shifts: Array<number | null | undefined> = []) {
  let scrollTop = 0;
  let position = start;
  let clock = 0;
  let frame = 0;
  const queue: Array<() => void> = [];
  const scrolls: number[] = [];
  const env: FollowEnv = {
    offset: () => (position === null ? null : position - scrollTop),
    scrollBy: (delta) => {
      scrollTop += delta;
      scrolls.push(delta);
    },
    frame: (callback) => {
      queue.push(callback);
      return () => queue.splice(queue.indexOf(callback), 1);
    },
    now: () => clock,
  };
  /** Runs the next frame 16 ms later, after the layout shift planned for it. */
  const step = () => {
    clock += 16;
    const shift = shifts[frame++];
    if (shift === null) position = null;
    else if (shift !== undefined) position = (position ?? 0) + shift;
    queue.shift()?.();
  };
  return { env, step, scrolls, get scrollTop() { return scrollTop; }, get pending() { return queue.length; } };
}

describe("hashId", () => {
  it("reads the element id of a hash", () => {
    expect(hashId("#risk")).toBe("risk");
    expect(hashId("risk")).toBe("risk");
    expect(hashId("#%E7%AC%94%E8%AE%B0")).toBe("笔记");
    expect(hashId("#")).toBeNull();
    expect(hashId("")).toBeNull();
    expect(hashId("#%E0%A4%A")).toBeNull();
  });
});

describe("follow", () => {
  it("scrolls to the target and keeps it in place while the panels above it load", () => {
    const page = fakePage(900, [0, 240, 0, 130]);
    follow(page.env, 1000);
    expect(page.scrollTop).toBe(900);
    for (let i = 0; i < 4; i++) page.step();
    expect(page.scrollTop).toBe(900 + 240 + 130);
    expect(page.scrolls).toEqual([900, 240, 130]);
  });

  it("waits for a target that is not rendered yet", () => {
    const page = fakePage(null, [undefined, 500]);
    follow(page.env, 1000);
    expect(page.scrolls).toEqual([]);
    page.step();
    page.step();
    expect(page.scrollTop).toBe(500);
  });

  it("ignores sub-pixel differences", () => {
    const page = fakePage(0.4);
    follow(page.env, 1000);
    expect(page.scrolls).toEqual([]);
  });

  it("ends after the duration and calls onEnd once", () => {
    const page = fakePage(100);
    let ended = 0;
    follow(page.env, 50, () => ended++);
    for (let i = 0; i < 10; i++) page.step();
    expect(ended).toBe(1);
    expect(page.pending).toBe(0);
  });

  it("stops at once when asked, without calling onEnd", () => {
    const page = fakePage(100, [0, 300]);
    let ended = 0;
    const stop = follow(page.env, 1000, () => ended++);
    stop();
    page.step();
    page.step();
    expect(page.scrollTop).toBe(100);
    expect(page.pending).toBe(0);
    expect(ended).toBe(0);
  });
});
