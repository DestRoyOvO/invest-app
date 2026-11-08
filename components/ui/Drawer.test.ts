import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Drawer, type DrawerSide } from "./Drawer";

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

  it("lets a sheet grow past 85dvh while it shows toasts, so they take room from the backdrop, not from the content", () => {
    const grow = "max-h-[calc(100dvh-2.75rem)]";
    const right = parts(render("right")).panel;
    const bottom = parts(render("bottom")).panel;
    const auto = parts(render("auto")).panel;
    expect(right.some((token) => token.endsWith(grow))).toBe(false);
    expect(bottom).toEqual(expect.arrayContaining(["max-h-[85dvh]", `has-[[data-toast]]:${grow}`]));
    expect(auto).toEqual(expect.arrayContaining(["max-h-[85dvh]", `max-sm:has-[[data-toast]]:${grow}`, "sm:max-h-none"]));
    expect(auto).not.toContain(`has-[[data-toast]]:${grow}`);
  });
});
