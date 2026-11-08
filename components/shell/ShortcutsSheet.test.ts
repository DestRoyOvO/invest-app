import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { ShortcutList } from "./ShortcutsSheet";

// Server-rendered markup of the keyboard reference: each list is named by its heading, so the page's own keys are found
// and announced as "On this page" rather than by where they sit. The keys a page registers come from the hotkey registry,
// which is empty on the server, so it is stubbed with two.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }), usePathname: () => "/" }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});
vi.mock("@/components/providers/UiProvider", () => ({ useUi: () => ({ shortcutsOpen: false, closeShortcuts: () => undefined }) }));
vi.mock("@/hooks/useHotkeys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useHotkeys")>()),
  useActiveHotkeys: () => [
    { key: "[", alt: false, description: "Previous range" },
    { key: "l", alt: false, description: "Log scale" },
  ],
}));

const s = MESSAGES.en.help.shortcuts;

/** Each list's name (the text of the element its aria-labelledby points at, tags stripped) and its number of items. */
function lists(markup: string) {
  const headings = new Map([...markup.matchAll(/<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)].map(([, id, inner]) => [id, inner.replace(/<[^>]+>/g, "")]));
  return [...markup.matchAll(/<ul aria-labelledby="([^"]+)"[^>]*>([\s\S]*?)<\/ul>/g)].map(([, id, inner]) => ({
    name: headings.get(id),
    items: [...inner.matchAll(/<li /g)].length,
  }));
}

describe("ShortcutList", () => {
  it("names every list by its heading, the page's own keys as On this page", () => {
    const found = lists(renderToStaticMarkup(createElement(ShortcutList)));
    expect(found.map((list) => list.name)).toEqual([s.global, `${s.goTo} · ${s.goHint}`, s.page]);
    expect(found[2].items).toBe(2);
  });

  it("leaves the page's list out, with its heading, where /help filters it away", () => {
    const found = lists(renderToStaticMarkup(createElement(ShortcutList, { pageKeys: false })));
    expect(found.map((list) => list.name)).not.toContain(s.page);
  });
});
