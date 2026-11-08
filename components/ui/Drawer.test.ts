import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createContentKeeper, Drawer, keptScrollTop, revealBy, type DrawerSide } from "./Drawer";

// Server-rendered markup of the Drawer: where its toast outlet sits and how a sheet makes room for toasts. Focus
// handling runs in effects, which the end-to-end specs cover.
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});

const html = (node: ReactNode) => renderToStaticMarkup(node);
const tokens = (classes: string) => classes.split(" ").filter(Boolean);

type DrawerProps = ComponentProps<typeof Drawer>;

/** A drawer with its body; children go in as createElement's third argument, which its typing wants in the props too. */
function drawer(props: Omit<DrawerProps, "children">, body: ReactNode): string {
  return html(createElement(Drawer, props as DrawerProps, body));
}

function render(side: DrawerSide, footer = true): string {
  const props = { open: true, onClose: () => undefined, title: "Research assistant", side, footer: footer ? createElement("form", null, "Ask") : undefined };
  return drawer(props, createElement("p", null, "Answers"));
}

/** The opening tag's class list of the dialog element and of the outlet in it, and the outlet's place in the dialog. */
function parts(markup: string) {
  const dialogAt = markup.indexOf('role="dialog"');
  const dialog = markup.slice(dialogAt);
  const outlet = /<div data-toast-outlet="true" class="([^"]*)"><\/div>/.exec(dialog);
  const panelClasses = /role="dialog"[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? "";
  return { dialogAt, dialog, outlet, outletAt: outlet ? dialog.indexOf(outlet[0]) : -1, panel: tokens(panelClasses), strip: tokens(outlet?.[1] ?? "") };
}

describe("Drawer", () => {
  it("renders nothing while closed", () => {
    expect(drawer({ open: false, onClose: () => undefined, title: "T" }, "body")).toBe("");
  });

  it("has a toast outlet inside the dialog, after its content and before its footer, on every side", () => {
    for (const side of ["right", "bottom", "auto"] as const) {
      for (const footer of [true, false]) {
        const { dialogAt, dialog, outlet, outletAt } = parts(render(side, footer));
        expect(dialogAt, side).toBeGreaterThan(0);
        expect(outlet, `${side}: one outlet in the dialog`).not.toBeNull();
        expect(dialog.indexOf("<p>Answers</p>"), side).toBeLessThan(outletAt);
        if (footer) expect(outletAt, side).toBeLessThan(dialog.indexOf("<form>Ask</form>"));
      }
    }
  });

  it("shows the toasts between the content and the footer of a side panel, and at the top of a sheet", () => {
    const right = parts(render("right")).strip;
    const bottom = parts(render("bottom")).strip;
    const auto = parts(render("auto")).strip;
    for (const strip of [right, bottom, auto]) expect(strip).toContain("shrink-0");
    expect(right.filter((token) => /(^|:)order-/.test(token))).toEqual([]);
    expect(right).toContain("has-[[data-toast]]:border-t");
    expect(bottom).toEqual(expect.arrayContaining(["order-first", "has-[[data-toast]]:border-b"]));
    // A sheet on phones, a side panel from sm.
    expect(auto).toEqual(expect.arrayContaining(["max-sm:order-first", "max-sm:has-[[data-toast]]:border-b", "sm:has-[[data-toast]]:border-t"]));
    expect(auto).not.toContain("order-first");
  });

  it("lets a sheet grow past 85dvh while it shows toasts, so they take room from the backdrop before the content", () => {
    const grow = "max-h-[calc(100dvh-2.75rem)]";
    const right = parts(render("right")).panel;
    const bottom = parts(render("bottom")).panel;
    const auto = parts(render("auto")).panel;
    expect(right.some((token) => token.endsWith(grow))).toBe(false);
    expect(bottom).toEqual(expect.arrayContaining(["max-h-[85dvh]", `has-[[data-toast]]:${grow}`]));
    expect(auto).toEqual(expect.arrayContaining(["max-h-[85dvh]", `max-sm:has-[[data-toast]]:${grow}`, "sm:max-h-none"]));
    expect(auto).not.toContain(`has-[[data-toast]]:${grow}`);
  });

  it("marks its scrolling content, beside the toast outlet in the dialog, for the content keeper", () => {
    const { dialog, outletAt } = parts(render("auto"));
    const content = dialog.indexOf('<div data-drawer-content="true" class="min-h-0 flex-1 overflow-y-auto"><p>Answers</p></div>');
    expect(content).toBeGreaterThan(0);
    expect(content).toBeLessThan(outletAt);
  });
});

// The numbers below are a phone (390x844) with the screener's filter sheet at its height limit: the content's visible
// area starts at y=160 with one toast in the strip above it, and each further toast adds 62px to the strip.
describe("keptScrollTop", () => {
  it("scrolls a sheet's content by as much as a new toast moves its top edge down, so what is on screen stays put", () => {
    expect(keptScrollTop({ scrollTop: 710, top: 160 }, { scrollTop: 710, top: 222 }, 798)).toBe(772);
  });

  it("scrolls back by as much as a closing toast moves the top edge up", () => {
    expect(keptScrollTop({ scrollTop: 400, top: 284 }, { scrollTop: 400, top: 172 }, 748)).toBe(288);
  });

  it("counts from the old offset when the browser already pulled it back to the end of the range", () => {
    // Scrolled to the end (834 of 860) when all three toasts close: the range shrinks to 748 and the browser clamps.
    expect(keptScrollTop({ scrollTop: 834, top: 284 }, { scrollTop: 748, top: 172 }, 748)).toBe(722);
    // Scrolled to the very end: the clamp alone kept the content in place.
    expect(keptScrollTop({ scrollTop: 860, top: 284 }, { scrollTop: 748, top: 172 }, 748)).toBe(748);
  });

  it("leaves the content alone when its top edge stays: a side panel, or a sheet still growing into the backdrop", () => {
    expect(keptScrollTop({ scrollTop: 300, top: 44 }, { scrollTop: 300, top: 44 }, 500)).toBe(300);
    expect(keptScrollTop({ scrollTop: 0, top: 412 }, { scrollTop: 0, top: 412 }, 0)).toBe(0);
  });

  it("keeps a scroll the page made in the same change, such as the browser's scroll anchoring", () => {
    expect(keptScrollTop({ scrollTop: 100, top: 160 }, { scrollTop: 130, top: 222 }, 900)).toBe(192);
  });

  it("stays within the scroll range", () => {
    expect(keptScrollTop({ scrollTop: 0, top: 172 }, { scrollTop: 0, top: 160 }, 732)).toBe(0);
    expect(keptScrollTop({ scrollTop: 700, top: 160 }, { scrollTop: 700, top: 222 }, 740)).toBe(740);
    expect(keptScrollTop({ scrollTop: 0, top: 172 }, { scrollTop: 0, top: 230 }, 0)).toBe(0);
  });
});

describe("revealBy", () => {
  it("brings a control that was in view back by the shortest way when the strip took the room where it sat", () => {
    // A side panel: the strip took the bottom of the area.
    expect(revealBy({ top: 700, bottom: 740, areaTop: 44, areaBottom: 800 }, { top: 700, bottom: 740, areaTop: 44, areaBottom: 730 })).toBe(10);
    // A sheet at its limit: the content stayed in place and the strip took the top of the area.
    expect(revealBy({ top: 170, bottom: 210, areaTop: 160, areaBottom: 787 }, { top: 170, bottom: 210, areaTop: 222, areaBottom: 787 })).toBe(-52);
  });

  it("shows the top edge of a control taller than the area", () => {
    expect(revealBy({ top: 100, bottom: 500, areaTop: 50, areaBottom: 600 }, { top: 100, bottom: 500, areaTop: 50, areaBottom: 400 })).toBe(50);
  });

  it("leaves a control that is still in view, or one the reader had scrolled away from", () => {
    expect(revealBy({ top: 300, bottom: 340, areaTop: 160, areaBottom: 787 }, { top: 300, bottom: 340, areaTop: 222, areaBottom: 787 })).toBe(0);
    expect(revealBy({ top: 900, bottom: 940, areaTop: 160, areaBottom: 787 }, { top: 900, bottom: 940, areaTop: 222, areaBottom: 787 })).toBe(0);
  });
});

describe("createContentKeeper", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A stand-in for the drawer's content, with the outlet beside it and a focusable control directly inside it. */
  function sheet({ top, scrollTop, scrollHeight, clientHeight }: { top: number; scrollTop: number; scrollHeight: number; clientHeight: number }) {
    const content = {
      top,
      scrollTop,
      scrollHeight,
      clientHeight,
      clientTop: 0,
      getBoundingClientRect: () => ({ top: content.top }),
      contains: (node: unknown) => node === control,
    };
    const control = { parentElement: content, top: 0, getBoundingClientRect: () => ({ top: control.top, bottom: control.top + 40 }) };
    const outlet = { parentElement: { querySelector: (selector: string) => (selector === ":scope > [data-drawer-content]" ? content : null) } };
    vi.stubGlobal("document", { activeElement: null });
    return { content, control, outlet: outlet as unknown as HTMLElement };
  }

  it("scrolls the content back by as much as the strip moved it, once per change", () => {
    const { content, outlet } = sheet({ top: 160, scrollTop: 710, scrollHeight: 1425, clientHeight: 627 });
    const keeper = createContentKeeper();
    keeper.before(outlet);
    content.top = 222;
    content.clientHeight = 565;
    keeper.after(outlet);
    expect(content.scrollTop).toBe(772);
    // Nothing noted since: a later call (another host's change) leaves the content alone.
    content.top = 284;
    keeper.after(outlet);
    expect(content.scrollTop).toBe(772);
  });

  it("does nothing without a note from before the change", () => {
    const { content, outlet } = sheet({ top: 160, scrollTop: 710, scrollHeight: 1425, clientHeight: 627 });
    content.top = 222;
    createContentKeeper().after(outlet);
    expect(content.scrollTop).toBe(710);
  });

  it("brings the focused control back into view when the strip took the room where it sat", () => {
    const { content, control, outlet } = sheet({ top: 160, scrollTop: 300, scrollHeight: 1425, clientHeight: 627 });
    vi.stubGlobal("document", { activeElement: control });
    // Near the top of the visible area: kept in place, it would sit above the area's new top edge.
    control.top = 170;
    const keeper = createContentKeeper();
    keeper.before(outlet);
    // A toast comes: the area's top edge moves down 62px and takes the control along.
    content.top = 222;
    content.clientHeight = 565;
    control.top = 232;
    // Scrolling the content moves the control the other way.
    Object.defineProperty(content, "scrollTop", {
      get: () => scrolled,
      set: (value: number) => {
        control.top -= value - scrolled;
        scrolled = value;
      },
    });
    let scrolled = 300;
    keeper.after(outlet);
    // Kept in place (offset 362, the control back at 170), then scrolled back just enough to show it at the area's top edge.
    expect(control.top).toBe(222);
    expect(scrolled).toBe(310);
  });
});
