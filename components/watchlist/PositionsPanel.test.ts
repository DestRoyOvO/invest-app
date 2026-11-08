import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { valuePortfolio, type PositionLike } from "@/lib/portfolio";

import { PositionsPanel } from "./PositionsPanel";

// Server-rendered markup of the positions panel's Add position buttons. The panel reads the messages, the UI actions and
// the app router, which only exist inside the app.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});
vi.mock("@/components/providers/UiProvider", () => ({ useUi: () => ({ openPositionEditor: () => undefined }) }));

/** The class lists of the Add position buttons in the panel's header and in its body. */
function addButtons(positions: PositionLike[], loading = false) {
  const markup = renderToStaticMarkup(createElement(PositionsPanel, { portfolio: valuePortfolio(positions, () => undefined), quotes: new Map(), loading }));
  const [header, body] = markup.split("</header>");
  const buttons = (part: string) =>
    [...part.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].filter((match) => match[2].includes("Add position")).map((match) => match[1].split(" "));
  return { header: buttons(header), body: buttons(body) };
}

describe("PositionsPanel's Add position", () => {
  it("is in the header and in the empty state without positions, but only in the empty state on phones", () => {
    const { header, body } = addButtons([]);
    expect(header).toHaveLength(1);
    expect(header[0]).toContain("max-sm:hidden");
    expect(body).toHaveLength(1);
    expect(body[0]).not.toContain("max-sm:hidden");
  });

  it("is in the header at every width once there are positions, or while they load", () => {
    for (const { positions, loading } of [
      { positions: [{ symbol: "AAPL", shares: 10, cost: 150 }], loading: false },
      { positions: [{ symbol: "AAPL", shares: 10, cost: 150 }], loading: true },
      { positions: [], loading: true },
    ]) {
      const { header, body } = addButtons(positions, loading);
      expect(header).toHaveLength(1);
      expect(header[0]).not.toContain("max-sm:hidden");
      expect(body).toHaveLength(0);
    }
  });
});
