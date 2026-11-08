import { afterEach, describe, expect, it, vi } from "vitest";

import { openAnchorOnClick } from "./HashLanding";

// openAnchorOnClick against a stand-in window: the address, history and events are all it touches.
vi.mock("next/navigation", () => ({ usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

function stubWindow(href: string) {
  const pushState = vi.fn();
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { location: new URL(href), history: { pushState, state: null }, dispatchEvent });
  vi.stubGlobal(
    "HashChangeEvent",
    class {
      constructor(
        readonly type: string,
        readonly init: object,
      ) {}
    },
  );
  return { pushState, dispatchEvent };
}

function click(keys: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> & { button?: number } = {}) {
  return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...keys };
}

describe("openAnchorOnClick", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an anchor of the open page in place on a plain click", () => {
    const { pushState, dispatchEvent } = stubWindow("http://127.0.0.1/data");
    const event = click();
    openAnchorOnClick(event as never, "/data#restore");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith(null, "", "/data#restore");
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it("leaves a click with a modifier key or another button to the browser", () => {
    const { pushState, dispatchEvent } = stubWindow("http://127.0.0.1/data");
    for (const keys of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = click(keys);
      openAnchorOnClick(event as never, "/data#import");
      expect(event.preventDefault, JSON.stringify(keys)).not.toHaveBeenCalled();
    }
    expect(pushState).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("leaves a link to another page to the router", () => {
    const { pushState } = stubWindow("http://127.0.0.1/watchlist");
    const event = click();
    openAnchorOnClick(event as never, "/data#restore");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });
});
