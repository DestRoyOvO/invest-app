import { load } from "cheerio/slim";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";
import type { SignalCode } from "@/types/api";

import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "./data";
import { isConcentrated, selectionTone } from "./evidence";
import { ReadingTrackPanel } from "./ReadingTrackPanel";

// The track record's readings table, server-rendered from the committed evaluation with two readings changed at the
// horizon shown first: one concentrated (one market stretch holds 60% of a reading seen on 15% of dates) whose interval
// excludes zero, and one with an interval above zero that is not. The committed file has no concentrated reading, so
// only here does a grey row show. DataTable reads the app router and the messages, which only exist inside the app.

const { CONCENTRATED, EDGE } = vi.hoisted(() => ({ CONCENTRATED: "strong_bearish" as const, EDGE: "strong_bullish" as const }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});
vi.mock("./data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./data")>();
  const evaluation = structuredClone(actual.SIGNAL_EVALUATION);
  const horizon = evaluation.horizons.find((h) => h.days === actual.EVALUATION_DAYS)!;
  const concentrated = horizon.labels.find((label) => label.code === CONCENTRATED)!;
  Object.assign(concentrated, { dates: Math.round(horizon.ic.dates * 0.15), largestEpisodeShare: 0.6, selection: 0.005, ci: { ...concentrated.ci, selection: [0.001, 0.009] } });
  const edge = horizon.labels.find((label) => label.code === EDGE)!;
  Object.assign(edge, { largestEpisodeShare: 0.1, selection: 0.003, ci: { ...edge.ci, selection: [0.0005, 0.006] } });
  return { ...actual, SIGNAL_EVALUATION: evaluation };
});

const L = MESSAGES.en.lab.track;
const HORIZON = SIGNAL_EVALUATION.horizons.find((h) => h.days === EVALUATION_DAYS)!;

/** The readings table of the default horizon and its rows by reading. */
function readingsTable() {
  const $ = load(renderToStaticMarkup(createElement(ReadingTrackPanel)));
  const table = $("table").filter((_, element) => $(element).find("caption").text() === tpl(L.labelsCaption, { days: EVALUATION_DAYS }));
  expect(table).toHaveLength(1);
  const heads = table.find("thead th").map((_, element) => $(element).text()).get();
  const row = (code: SignalCode) => table.find("tbody tr").filter((_, element) => $(element).find("td").first().text() === MESSAGES.en.signal.codes[code]);
  const cell = (code: SignalCode, head: string) => {
    expect(heads).toContain(head);
    return row(code).find("td").eq(heads.indexOf(head));
  };
  return { $, row, cell };
}

describe("ReadingTrackPanel readings", () => {
  it("starts from the readings this test changed", () => {
    const concentrated = HORIZON.labels.find((label) => label.code === CONCENTRATED)!;
    const edge = HORIZON.labels.find((label) => label.code === EDGE)!;
    expect(isConcentrated(concentrated, HORIZON.ic.dates)).toBe(true);
    expect(selectionTone(concentrated, HORIZON.ic.dates)).toBe("neutral");
    expect(isConcentrated(edge, HORIZON.ic.dates)).toBe(false);
    expect(selectionTone(edge, HORIZON.ic.dates)).toBe("up");
  });

  it("greys a concentrated reading's row throughout: name, return and whisker", () => {
    const { row, cell } = readingsTable();
    expect(row(CONCENTRATED)).toHaveLength(1);
    expect(row(CONCENTRATED).hasClass("text-fg-3")).toBe(true);
    expect(row(CONCENTRATED).hasClass("text-fg-2")).toBe(false);
    // The name and the return inherit the row's grey: no ink of their own, although the interval excludes zero.
    expect(cell(CONCENTRATED, L.labelCols.reading).find("span").attr("class")).toBeUndefined();
    const selection = cell(CONCENTRATED, L.labelCols.selection);
    expect(selection.find("span.num").first().attr("class")).toBe("num");
    expect(selection.find("svg[role=img] circle").attr("fill")).toBe("var(--fg-3)");
  });

  it("keeps every other row in --fg-2, and colors a return and its dot where the interval excludes zero", () => {
    const { row, cell } = readingsTable();
    for (const label of HORIZON.labels.filter((entry) => entry.code !== CONCENTRATED)) {
      expect(row(label.code).hasClass("text-fg-2"), label.code).toBe(true);
      expect(row(label.code).hasClass("text-fg-3"), label.code).toBe(false);
      expect(cell(label.code, L.labelCols.reading).find("span").hasClass("text-fg"), label.code).toBe(true);
    }
    const selection = cell(EDGE, L.labelCols.selection);
    expect(selection.find("span.num").first().hasClass("text-up")).toBe(true);
    expect(selection.find("svg[role=img] circle").attr("fill")).toBe("var(--accent)");
  });
});
