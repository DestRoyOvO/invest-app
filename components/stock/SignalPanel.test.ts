import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { pct } from "@/components/lab/stats-format";
import { findHorizon } from "@/lib/evaluation";
import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "@/lib/evaluation-data";
import { MESSAGES } from "@/lib/i18n/messages";
import { tpl } from "@/lib/format";
import type { SignalReport } from "@/types/api";

import { SignalPanel } from "./SignalPanel";

// The track record of the reading on the quote page. No row of the committed evaluation is grey, so two readings of the
// default horizon get an interval that excludes zero: one held in a single market stretch (a concentrated, grey row) and
// one spread over many episodes.
vi.mock("@/lib/evaluation-data", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/evaluation-data")>();
  const evaluation = structuredClone(real.SIGNAL_EVALUATION);
  const horizon = evaluation.horizons.find((h) => h.days === real.EVALUATION_DAYS);
  if (!horizon || horizon.labels.length < 2) throw new Error("The evaluation has no default horizon with two readings.");
  const interval: [number, number] = [0.001, 0.004];
  const [grey, spread] = horizon.labels;
  Object.assign(grey, { dates: 40, largestEpisodeShare: 0.9, selection: 0.0025, ci: { ...grey.ci, selection: interval } });
  Object.assign(spread, { dates: 40, largestEpisodeShare: 0.1, selection: 0.0025, ci: { ...spread.ci, selection: interval } });
  return { ...real, SIGNAL_EVALUATION: evaluation };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});

const report = {
  symbol: "AAPL",
  asOf: "2026-11-07T15:00:00.000Z",
  status: "ok",
  code: null,
  score: 50,
  technicalScore: 50,
  consensus: null,
  coverage: null,
  confidence: null,
  factors: [],
  backtest: null,
  meta: { bars: 500, droppedPartialBar: false, lastBarDate: "2026-11-06" },
} as unknown as SignalReport;

/** The markup of the whisker named `label` (React escapes its attribute value). */
function whisker(markup: string, label: string): string {
  const escaped = label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const at = markup.indexOf(`aria-label="${escaped}"`);
  expect(at, label).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf("<svg", at), markup.indexOf("</svg>", at));
}

describe("SignalPanel track record", () => {
  const t = MESSAGES.en;
  const horizon = findHorizon(SIGNAL_EVALUATION, EVALUATION_DAYS);
  const markup = renderToStaticMarkup(createElement(SignalPanel, { report, error: undefined, onRetry: () => undefined }));
  const label = (index: number) => {
    const row = horizon!.labels[index];
    return tpl(t.signal.track.whisker, { reading: t.signal.codes[row.code], value: pct(row.selection, 2, true), lo: pct(row.ci.selection?.[0], 2, true), hi: pct(row.ci.selection?.[1], 2, true) });
  };

  it("greys the whisker of a concentrated row, even when its interval excludes zero", () => {
    const glyph = whisker(markup, label(0));
    expect(glyph).toMatch(/<circle[^>]*fill="var\(--fg-3\)"/);
    expect(glyph).not.toContain("var(--accent)");
  });

  it("keeps the accent dot for a row spread over many episodes whose interval excludes zero", () => {
    expect(whisker(markup, label(1))).toMatch(/<circle[^>]*fill="var\(--accent\)"/);
  });
});
