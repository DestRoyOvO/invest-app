import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { dockedRegionClass, stackClass, ToastCard, toastCardClass, ToastOutlet, ToastProvider, ToastStacks } from "./Toast";

// Server-rendered markup of the toasts: the live region the provider keeps, a toast card, and the outlet a dialog
// renders for them. Moving the toasts into an outlet happens in the browser (a portal); the end-to-end specs check it.
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});

const html = (node: ReactNode) => renderToStaticMarkup(node);
const tokens = (classes: string) => classes.split(" ").filter(Boolean);
const noop = () => undefined;

describe("ToastProvider", () => {
  it("keeps a polite live region at the screen's edge, over the page and its drawers, before any toast", () => {
    const markup = html(createElement(ToastProvider, null, createElement("main", null, "page")));
    const match = /^<main>page<\/main><div class="([^"]*)"><div aria-live="polite" class="([^"]*)"><\/div><\/div>$/.exec(markup);
    expect(match).not.toBeNull();
    const host = tokens(match?.[1] ?? "");
    // Above the tab bar on phones, bottom right from md; above the drawers (z-50), letting clicks through between toasts.
    expect(host).toEqual(expect.arrayContaining(["fixed", "bottom-16", "md:bottom-10", "md:right-4", "z-[60]", "pointer-events-none"]));
    // The live stack inside it: centered cards on phones, right-aligned from md.
    expect(tokens(match?.[2] ?? "")).toEqual(tokens(stackClass(false)));
  });
});

describe("ToastCard", () => {
  const toast = { id: "t1", message: "Removed MSFT", action: { label: "Undo", onAction: noop } };
  const card = (docked: boolean) => html(createElement(ToastCard, { toast, docked, dismissLabel: "Dismiss", onDismiss: noop }));

  it("names its buttons by their action and describes them by the message, so Dismiss says what it closes", () => {
    const markup = card(false);
    const messageId = /<div id="([^"]+)" class="min-w-0 flex-1">Removed MSFT<\/div>/.exec(markup)?.[1];
    expect(messageId).toBeTruthy();
    const buttons = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, content]) => ({ attributes, content }));
    expect(buttons).toHaveLength(2);
    expect(buttons[0].content).toBe("Undo");
    expect(buttons[1].attributes).toContain('aria-label="Dismiss"');
    for (const button of buttons) expect(button.attributes).toContain(`aria-describedby="${messageId}"`);
  });

  it("has no action button without an action", () => {
    const markup = html(createElement(ToastCard, { toast: { id: "t2", message: "Copied as Markdown." }, docked: true, dismissLabel: "Dismiss", onDismiss: noop }));
    expect([...markup.matchAll(/<button/g)]).toHaveLength(1);
    expect(markup).toContain('aria-label="Dismiss"');
  });

  it("is a card of its own width at the screen's edge and spans the strip in a dialog's outlet", () => {
    const edge = tokens(toastCardClass(false));
    const docked = tokens(toastCardClass(true));
    expect(edge).toEqual(expect.arrayContaining(["w-full", "max-w-sm", "md:w-auto", "md:min-w-72", "shadow-xl"]));
    expect(docked).toContain("w-full");
    for (const token of ["max-w-sm", "md:w-auto", "md:min-w-72", "shadow-xl"]) expect(docked).not.toContain(token);
    // Both stay operable inside a region that lets clicks through.
    expect(edge).toContain("pointer-events-auto");
    expect(docked).toContain("pointer-events-auto");
    expect(card(true)).toContain("data-toast");
  });

  it("keeps 40px phone targets for its action and Dismiss", () => {
    const markup = card(true);
    const classes = [...markup.matchAll(/<button[^>]*class="([^"]*)"/g)].map((match) => tokens(match[1]));
    expect(classes[0]).toContain("max-sm:h-10");
    expect(classes[1]).toContain("max-sm:size-10");
  });
});

describe("the docked region", () => {
  it("takes no room without toasts and pads the strip once one shows", () => {
    expect(tokens(dockedRegionClass(0))).not.toContain("py-2");
    expect(tokens(dockedRegionClass(1))).toContain("py-2");
    expect(tokens(dockedRegionClass(3))).toEqual(expect.arrayContaining(["flex", "flex-col", "px-3", "py-2"]));
  });
});

describe("the stacks of a host", () => {
  it("space their cards 8px apart, and the live stack 8px from the carried one above it", () => {
    expect(tokens(stackClass(true))).toEqual(["flex", "flex-col", "gap-2"]);
    expect(tokens(stackClass(false))).toEqual(expect.arrayContaining(["w-full", "items-center", "md:items-end", "gap-2"]));
    expect(tokens(stackClass(true, true))).toContain("mt-2");
    expect(tokens(stackClass(false, true))).toContain("mt-2");
    expect(tokens(stackClass(false))).not.toContain("mt-2");
  });
});

describe("ToastStacks", () => {
  const removed = { id: "a", message: "Removed MSFT", action: { label: "Undo", onAction: noop } };
  const saved = { id: "b", message: "Alert saved: AAPL" };
  const copied = { id: "c", message: "Copied as Markdown." };
  const stacks = (props: { docked: boolean; active: boolean; carried?: (typeof saved)[]; fresh?: (typeof saved)[] }) =>
    html(createElement(ToastStacks, { carried: [], fresh: [], dismissLabel: "Dismiss", onDismiss: noop, ...props }));
  /**
   * The toast messages outside the polite live region and inside it, and how many live regions there are. The live
   * region is the last element (it runs to the end of the markup), so everything before it is outside it.
   */
  const split = (markup: string) => {
    const at = markup.indexOf('<div aria-live="polite"');
    const tail = markup.slice(at);
    expect(at, "a live region").toBeGreaterThanOrEqual(0);
    expect(tail.split("<div").length, "the live region runs to the end").toBe(tail.split("</div>").length);
    const messages = (part: string) => [...part.matchAll(/<div id="[^"]+" class="min-w-0 flex-1">([^<]*)<\/div>/g)].map((match) => match[1]);
    return { outside: messages(markup.slice(0, at)), inside: messages(tail), regions: markup.split("aria-live=").length - 1 };
  };

  it("put the toasts first shown in a host in its polite live region, in a dialog's outlet and at the screen's edge", () => {
    for (const docked of [true, false]) {
      const markup = stacks({ docked, active: true, fresh: [saved, copied] });
      expect(split(markup), `docked: ${docked}`).toEqual({ outside: [], inside: ["Alert saved: AAPL", "Copied as Markdown."], regions: 1 });
      expect(markup.startsWith(`<div aria-live="polite" class="${stackClass(docked)}">`), `docked: ${docked}`).toBe(true);
    }
  });

  it("keep the toasts carried in from another host out of the live region, before it, so they are not announced again", () => {
    for (const docked of [true, false]) {
      const markup = stacks({ docked, active: true, carried: [removed, saved], fresh: [copied] });
      expect(split(markup), `docked: ${docked}`).toEqual({ outside: ["Removed MSFT", "Alert saved: AAPL"], inside: ["Copied as Markdown."], regions: 1 });
      // The carried stack is a plain stack, not a second live region.
      expect(markup.startsWith(`<div class="${stackClass(docked)}"><div data-toast`), `docked: ${docked}`).toBe(true);
      expect(split(stacks({ docked, active: true, carried: [saved] })), `docked: ${docked}`).toEqual({ outside: ["Alert saved: AAPL"], inside: [], regions: 1 });
    }
  });

  it("keep an empty live region in a host that shows no toasts, so a toast that lands there later is announced", () => {
    // The screen's edge while a drawer hosts the toasts: nothing of the toasts, but the live region stays.
    expect(stacks({ docked: false, active: false, carried: [removed], fresh: [copied] })).toBe(`<div aria-live="polite" class="${stackClass(false)}"></div>`);
    expect(stacks({ docked: true, active: true })).toBe(`<div aria-live="polite" class="${stackClass(true)}"></div>`);
  });

  it("space the live region 8px from a carried stack only when both have toasts", () => {
    expect(stacks({ docked: true, active: true, carried: [saved], fresh: [copied] })).toContain(`aria-live="polite" class="${stackClass(true, true)}"`);
    expect(stacks({ docked: true, active: true, carried: [saved] })).toContain(`aria-live="polite" class="${stackClass(true)}"`);
  });
});

describe("the Dismiss button of a toast", () => {
  it("is named apart from the Close of the dialog a toast can sit in, in both languages", () => {
    for (const t of [MESSAGES.en, MESSAGES.zh]) {
      expect(t.common.dismiss).toBeTruthy();
      expect(t.common.dismiss).not.toBe(t.common.close);
    }
  });
});

describe("ToastOutlet", () => {
  it("is an empty element the toasts move into, with or without a provider", () => {
    expect(html(createElement(ToastOutlet, { className: "shrink-0" }))).toBe('<div data-toast-outlet="true" class="shrink-0"></div>');
    const inProvider = html(createElement(ToastProvider, null, createElement(ToastOutlet)));
    expect(inProvider.startsWith('<div data-toast-outlet="true"></div><div class="pointer-events-none fixed')).toBe(true);
  });
});
