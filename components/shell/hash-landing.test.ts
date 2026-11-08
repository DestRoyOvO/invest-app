import { describe, expect, it } from "vitest";

import { follow, hashId, type FollowEnv } from "./hash-landing";

/**
 * A scrolling area 800px tall whose target starts `position` px down the content. Each step runs one frame 16 ms
 * later, after an optional change: the target moving as panels above it load, the content growing, or the browser
 * scrolling by itself.
 */
function fakePage(position: number | null, contentHeight = 4000) {
  const page = {
    position,
    contentHeight,
    scrollTop: 0,
    scrolls: [] as number[],
    queue: [] as Array<() => void>,
    clock: 0,
    /** Scrolls the way the browser does: never past either end of the content. */
    scrollTo: (top: number) => {
      page.scrollTop = Math.min(Math.max(0, top), Math.max(0, page.contentHeight - 800));
    },
    /** Content above the target grows (or shrinks) by `delta` px. */
    shift: (delta: number) => {
      page.position = (page.position ?? 0) + delta;
    },
  };
  const env: FollowEnv = {
    offset: () => (page.position === null ? null : page.position - page.scrollTop),
    scrollBy: (delta) => {
      page.scrolls.push(delta);
      page.scrollTo(page.scrollTop + delta);
    },
    frame: (callback) => {
      page.queue.push(callback);
      return () => page.queue.splice(page.queue.indexOf(callback), 1);
    },
    now: () => page.clock,
  };
  const step = (change?: () => void) => {
    page.clock += 16;
    change?.();
    page.queue.shift()?.();
  };
  return { page, env, step };
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
  it("keeps the target at the top while the panels above it load", () => {
    const { page, env, step } = fakePage(900);
    follow(env);
    expect(page.scrollTop).toBe(900);
    step(() => (page.position = 1140));
    step();
    step(() => (page.position = 1270));
    expect(page.scrollTop).toBe(1270);
    expect(page.scrolls).toEqual([900, 240, 130]);
  });

  it("finishes the landing once a page that was too short has grown", () => {
    // The quote page is skeletons at first: 1100px of content, so the risk panel at 900 cannot reach the top.
    const { page, env, step } = fakePage(900, 1100);
    follow(env, { settled: 100 });
    expect(page.scrollTop).toBe(300);
    // Slow data: the skeletons stay longer than the settle time, which does not count while the target is short of the top.
    for (let i = 0; i < 20; i++) step();
    step(() => {
      page.contentHeight = 3600;
      page.position = 1225;
    });
    expect(page.scrollTop).toBe(1225);
  });

  it("waits for a target that is not rendered yet", () => {
    const { page, env, step } = fakePage(null);
    follow(env, { settled: 100 });
    for (let i = 0; i < 20; i++) step();
    expect(page.scrolls).toEqual([]);
    step(() => (page.position = 500));
    expect(page.scrollTop).toBe(500);
  });

  it("ignores sub-pixel differences", () => {
    const { page, env } = fakePage(0.4);
    follow(env);
    expect(page.scrolls).toEqual([]);
  });

  it("leaves the browser's own adjustments alone", () => {
    const { page, env, step } = fakePage(900);
    follow(env);
    // Scroll anchoring: content above grows by 240 and the browser scrolls by as much, so the target stays put.
    step(() => {
      page.shift(240);
      page.scrollTop += 240;
    });
    expect(page.scrolls).toEqual([900]);
    step(() => page.shift(100));
    expect(page.scrollTop).toBe(1240);
  });

  it("ends once the target has stayed at the top for the settle time", () => {
    const { page, env, step } = fakePage(900);
    let ended = 0;
    follow(env, { settled: 100 }, () => ended++);
    for (let i = 0; i < 4; i++) step();
    // A shift starts the settle time again.
    step(() => page.shift(50));
    for (let i = 0; i < 5; i++) step();
    expect(ended).toBe(0);
    for (let i = 0; i < 3; i++) step();
    expect(ended).toBe(1);
    expect(page.queue).toHaveLength(0);
  });

  it("ends after the duration and calls onEnd once", () => {
    const { page, env, step } = fakePage(900, 1100);
    let ended = 0;
    follow(env, { duration: 50 }, () => ended++);
    for (let i = 0; i < 10; i++) step();
    expect(ended).toBe(1);
    expect(page.queue).toHaveLength(0);
  });

  it("stops at once when asked, without calling onEnd", () => {
    const { page, env, step } = fakePage(100);
    let ended = 0;
    const stop = follow(env, {}, () => ended++);
    stop();
    step(() => (page.position = 400));
    expect(page.scrollTop).toBe(100);
    expect(page.queue).toHaveLength(0);
    expect(ended).toBe(0);
  });
});
