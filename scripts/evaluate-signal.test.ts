import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COMMON_READING_DATE_SHARE, EPISODE_SHARE_LIMIT } from "../components/lab/evidence";
import { pct } from "../components/lab/stats-format";
import type { SignalEvaluation } from "../lib/evaluation";
import { tpl } from "../lib/format";
import { MESSAGES } from "../lib/i18n/messages";
import committed from "../lib/signal-evaluation.json";

import { readConfig, renderEvaluationReport } from "./evaluate-signal";

// docs/evaluation.md is rendered from the rounded evaluation, which is what lib/signal-evaluation.json holds, so the
// committed report and the committed JSON must agree with the generator's text.

const config = readConfig();
const symbols = { market: config.data.market, equalWeight: config.data.equalWeight, dataFrom: config.data.from };
const evaluation = committed as unknown as SignalEvaluation;
const render = (value: SignalEvaluation) => renderEvaluationReport(value, config.signal, symbols);
const greyParagraph = (report: string) => report.split("\n").find((line) => line.startsWith("In the app (/lab")) ?? "";

/** The committed evaluation with one reading's largest episode share replaced at the given horizons. */
function withEpisodeShare(code: string, value: number, days?: number): SignalEvaluation {
  const copy = structuredClone(evaluation);
  for (const horizon of copy.horizons) {
    if (days !== undefined && horizon.days !== days) continue;
    for (const label of horizon.labels) if (label.code === code) label.largestEpisodeShare = value;
  }
  return copy;
}

describe("the evaluation report", () => {
  it("is what the generator prints for the committed evaluation", () => {
    expect(readFileSync("docs/evaluation.md", "utf8").replace(/\r\n/g, "\n")).toBe(render(evaluation));
  });

  it("states the grey-row rule with its thresholds and what it does in this run", () => {
    const paragraph = greyParagraph(render(evaluation));
    expect(paragraph).toContain("largest episode holds more than 30% of its observations");
    // What selectionTone (components/lab/evidence.ts) does to a grey row's value; the interval glyph is not claimed.
    expect(paragraph).toContain("its selection value is then not colored even when the interval excludes zero");
    expect(paragraph).toContain("Readings seen on at least 50% of all dates are exempt");
    expect(paragraph).toContain("Here Strong, Neutral and Weak are exempt at every horizon, and no row is grey.");
  });

  it("states the same rule as the legend under the track record tables, in both languages", () => {
    // ReadingTrackPanel (/lab) and SignalPanel (quote pages) fill the legend with these values.
    const legend = (lang: "en" | "zh") => tpl(MESSAGES[lang].signal.track.colors, { limit: pct(EPISODE_SHARE_LIMIT, 0), share: pct(COMMON_READING_DATE_SHARE, 0) });
    // More than 30% (strictly) greys a row; at least 50% of dates (inclusive) exempts a reading.
    expect(legend("en")).toContain("largest episode holds more than 30% of its observations, except for readings seen on at least 50% of dates");
    expect(legend("zh")).toContain("若样本最多的一段占该读数全部样本的比例超过 30%，该行显示为灰色；出现日期占全部日期 50% 及以上的读数除外");
  });

  it("names the episode with the most observations, not the longest, in the legend and the foot", () => {
    // countEpisodes (lib/evaluation.ts) measures an episode by its observations, so a short run with many stocks can
    // be the largest. The Chinese 样本 is the word the tables use for observations.
    const { colors, foot } = MESSAGES.zh.signal.track;
    expect(MESSAGES.en.signal.track.foot).toContain("the largest run's share");
    for (const text of [colors, foot]) {
      expect(text).toContain("样本最多的一段");
      expect(text).not.toContain("最长");
    }
  });

  it("names the rows the rule greys, per horizon when they differ", () => {
    expect(greyParagraph(render(withEpisodeShare("strong_bearish", 0.4)))).toContain("Here Strong, Neutral and Weak are exempt at every horizon, and Very weak is grey.");
    // Exempt readings stay colored however long their runs are.
    expect(greyParagraph(render(withEpisodeShare("bearish", 0.9)))).toContain("and no row is grey.");
    expect(greyParagraph(render(withEpisodeShare("strong_bullish", 0.31, 20)))).toContain(
      "Here, at 5 sessions Strong, Neutral and Weak are exempt and no row is grey; at 10 sessions Strong, Neutral and Weak are exempt and no row is grey; " +
        "at 20 sessions Strong, Neutral and Weak are exempt and Very strong is grey.",
    );
  });
});
