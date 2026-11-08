import { describe, expect, it } from "vitest";

import { anchorOnPage, follow, hashId, landingFor, lastFragment, type FollowEnv, type Place } from "./hash-landing";

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

  it("reads the last fragment of a hash the router prefixed", () => {
    expect(lastFragment("#risk#chart")).toBe("#chart");
    expect(lastFragment("#import#paste")).toBe("#paste");
    expect(lastFragment("#risk")).toBe("#risk");
    expect(lastFragment("")).toBe("");
    expect(hashId("#risk#notes")).toBe("notes");
    expect(hashId("#risk#%E7%AC%94%E8%AE%B0")).toBe("笔记");
    expect(hashId("#risk#")).toBeNull();
  });
});

describe("landingFor", () => {
  const place = (href: string): Place => {
    const url = new URL(href, "http://localhost");
    return { pathname: url.pathname, search: url.search, hash: url.hash };
  };
  const first = place("/stock/AAPL#risk");

  it("takes the address as it is when the router cannot have prefixed it", () => {
    expect(landingFor(place("/markets#rates"), null)).toEqual({ hash: "#rates", first: null });
    expect(landingFor(place("/markets"), first)).toEqual({ hash: "", first });
    expect(landingFor(place("/markets#rates"), first)).toEqual({ hash: "#rates", first });
    // The first address had a search of its own: other searches on that path have entries of their own.
    const withSearch = place("/portfolio?tab=correlation#x");
    expect(landingFor(place("/portfolio#x"), withSearch)).toEqual({ hash: "#x", first: withSearch });
  });

  it("strips the hash of the first address from a plain link back to it", () => {
    // Quote in the rail, the overview tab, a watchlist row: the router writes /stock/AAPL#risk.
    expect(landingFor(place("/stock/AAPL#risk"), first)).toEqual({ hash: "", first });
    // Another tab of the same quote, built from the first entry while that tab is not cached yet.
    expect(landingFor(place("/stock/AAPL?tab=financials#risk"), first)).toEqual({ hash: "", first });
    expect(landingFor(place("/stock/AAPL?compare=MSFT#risk"), first)).toEqual({ hash: "", first });
  });

  it("keeps what a hash link asked for after the prefix", () => {
    expect(landingFor(place("/stock/AAPL#risk#chart"), first)).toEqual({ hash: "#chart", first });
    expect(landingFor(place("/stock/AAPL#risk#risk"), first)).toEqual({ hash: "#risk", first });
    expect(landingFor(place("/stock/AAPL#risk#notes"), first)).toEqual({ hash: "#notes", first });
    // A first address with two fragments (reloaded from a prefixed one) is prefixed whole.
    const twice = place("/data#import#paste");
    expect(landingFor(place("/data#import#paste"), twice)).toEqual({ hash: "", first: twice });
    expect(landingFor(place("/data#import#paste#restore"), twice)).toEqual({ hash: "#restore", first: twice });
  });

  it("follows the link or command that started the navigation when it is known", () => {
    expect(landingFor(place("/stock/AAPL#risk"), first, "")).toEqual({ hash: "", first });
    expect(landingFor(place("/stock/AAPL#risk#chart"), first, "#chart")).toEqual({ hash: "#chart", first });
    // Exactly what was asked for: the router has dropped the first entry, so nothing is stripped from now on.
    expect(landingFor(place("/stock/AAPL#risk"), first, "#risk")).toEqual({ hash: "#risk", first: null });
    expect(landingFor(place("/stock/AAPL"), first, "")).toEqual({ hash: "", first: null });
    // Another search may have come from an entry of its own: that says nothing about the first one.
    expect(landingFor(place("/stock/AAPL?tab=financials"), first, "")).toEqual({ hash: "", first });
  });

  it("forgets the first address once the router writes that page without its hash", () => {
    expect(landingFor(place("/stock/AAPL"), first)).toEqual({ hash: "", first: null });
    expect(landingFor(place("/stock/AAPL#chart"), first)).toEqual({ hash: "#chart", first: null });
    // A hash that only starts with the same letters is another anchor, not the prefix.
    expect(landingFor(place("/stock/AAPL#riskier"), first)).toEqual({ hash: "#riskier", first: null });
    expect(landingFor(place("/stock/AAPL?tab=financials"), first)).toEqual({ hash: "", first });
  });

  it("returns to a history entry as it was written", () => {
    expect(landingFor(place("/stock/AAPL#risk"), first, undefined, true)).toEqual({ hash: "#risk", first });
    expect(landingFor(place("/stock/AAPL"), first, "#chart", true)).toEqual({ hash: "", first });
  });
});

describe("anchorOnPage", () => {
  const here = "http://localhost/stock/AAPL";

  it("finds an anchor on the page that is open", () => {
    expect(anchorOnPage("/stock/AAPL#risk", here)?.hash).toBe("#risk");
    expect(anchorOnPage("/stock/AAPL#risk", `${here}#risk`)?.hash).toBe("#risk");
    expect(anchorOnPage("#paste", "http://localhost/data")?.href).toBe("http://localhost/data#paste");
  });

  it("leaves other pages, other searches and plain addresses to the router", () => {
    expect(anchorOnPage("/stock/MSFT#risk", here)).toBeNull();
    expect(anchorOnPage("/stock/AAPL?tab=financials#risk", here)).toBeNull();
    expect(anchorOnPage("/stock/AAPL#risk", "http://localhost/stock/AAPL?tab=financials")).toBeNull();
    expect(anchorOnPage("/stock/AAPL", `${here}#risk`)).toBeNull();
    expect(anchorOnPage("/stock/AAPL#", here)).toBeNull();
    expect(anchorOnPage("https://example.com/stock/AAPL#risk", here)).toBeNull();
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

  it("rests at the top when the target already sits above its place there", () => {
    // /markets#rates on a desktop: the panel starts 1px below the top and lands 8px below it, with nothing to scroll.
    const { page, env, step } = fakePage(-7);
    let ended = 0;
    follow(env, { settled: 100 }, () => ended++);
    for (let i = 0; i < 6; i++) step();
    expect(page.scrollTop).toBe(0);
    expect(ended).toBe(0);
    step();
    expect(ended).toBe(1);
    expect(page.queue).toHaveLength(0);
  });

  it("follows a target that rested above its place once the content above it grows", () => {
    const { page, env, step } = fakePage(-7);
    follow(env, { settled: 100 });
    step();
    step(() => page.shift(400));
    expect(page.scrollTop).toBe(393);
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
