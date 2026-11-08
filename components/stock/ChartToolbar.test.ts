import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});

import { DEFAULT_CHART_SETTINGS, type ChartStudy } from "./chart-settings";
import { StudiesPanel } from "./ChartToolbar";

// The studies menu's switches as server-rendered markup: the open menu of the quote page's chart.

const REASON = "No volume data for ^TNX";

const render = (unavailable?: Partial<Record<ChartStudy, string>>) =>
  renderToStaticMarkup(
    createElement(StudiesPanel, { id: "studies", settings: { ...DEFAULT_CHART_SETTINGS, volume: true }, onChange: () => undefined, unavailable }),
  );

/** Each switch's markup, by its label. */
function switches(markup: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [button] of markup.matchAll(/<button[^>]*role="switch".*?<\/button>/g)) {
    const label = /<span id="[^"]*-label"[^>]*>([^<]*)<\/span>/.exec(button)?.[1];
    if (label) found.set(label, button);
  }
  return found;
}

describe("StudiesPanel", () => {
  it("keeps the reason a study is unavailable out of its dimmed, disabled switch, and describes the menu with it", () => {
    const markup = render({ volume: REASON });
    const volume = switches(markup).get("Volume")!;
    expect(volume).toContain('aria-checked="false"');
    expect(volume).toContain('disabled=""');
    expect(volume).not.toContain(REASON);
    expect(volume).not.toContain("aria-describedby");

    // A line of its own after the switch, in the quiet text color at full opacity.
    const reason = /<p id="([^"]+)" class="([^"]+)">([^<]*)<\/p>/.exec(markup);
    expect(reason?.[3]).toBe(REASON);
    expect(markup.indexOf(reason![0])).toBeGreaterThan(markup.indexOf(volume));
    const classes = reason![2].split(" ");
    expect(classes).toContain("text-fg-3");
    expect(classes.some((token) => token.includes("opacity"))).toBe(false);

    // Tab skips the disabled switch, so the group carries the reason for screen readers.
    const group = /<div id="studies" role="group"[^>]*>/.exec(markup)![0];
    expect(group).toContain(`aria-describedby="${reason![1]}"`);

    // The other studies stay available.
    for (const [label, button] of switches(markup)) {
      if (label !== "Volume") expect(button, label).not.toContain('disabled=""');
    }
  });

  it("follows the saved settings, without reasons or a description, when the symbol can draw every study", () => {
    const markup = render();
    expect(switches(markup).size).toBe(7);
    expect(switches(markup).get("Volume")).toContain('aria-checked="true"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain("aria-describedby");
    expect(markup).not.toContain("<p");
  });
});
