import { EPISODE_SHARE_LIMIT, isConcentrated, selectionTone } from "@/components/lab/evidence";
import { formatCorrelation, formatIc, formatP, formatT, pct, yearSpan } from "@/components/lab/stats-format";
import factorResearchJson from "@/lib/factor-research.json";
import { tpl } from "@/lib/format";
import { MESSAGES } from "@/lib/i18n/messages";
import riskCalibrationJson from "@/lib/risk-calibration.json";
import signalEvaluationJson from "@/lib/signal-evaluation.json";
import type { FactorResearch, RiskCalibration, SignalEvaluation } from "@/lib/evaluation";

import { panel, readCells, tokenColors } from "../support/research";
import { expect, test } from "../support/test";

// The factor lab (/lab) against the committed research files it is drawn from: the pre-registered factor tests with
// their Holm-adjusted p-values and the verdict tally (lib/factor-research.json), the track record of the reading
// with its grey rows and colored returns decided by components/lab/evidence.ts (lib/signal-evaluation.json), and the
// coverage of the risk forecast's ranges (lib/risk-calibration.json). Every expected figure is computed from those
// files here; none is copied by hand. Tables are read whole (e2e/support/research.ts, readCells) and compared in one
// polled assertion each.

const RESEARCH = factorResearchJson as unknown as FactorResearch;
const EVALUATION = signalEvaluationJson as unknown as SignalEvaluation;
const CALIBRATION = riskCalibrationJson as unknown as RiskCalibration;
const L = MESSAGES.en.lab;

test.describe("factor lab", () => {
  test.skip(({ isMobile }) => isMobile, "The lab shows the same files on phones, in scrolling tables; one project is enough.");

  test("the factor tests list every pre-registered test with its Holm-adjusted p and the verdicts", async ({ page, app }) => {
    await app.goto("/lab");
    const tests = RESEARCH.factors.flatMap((factor) => factor.results);
    const passed = tests.filter((result) => result.verdict === "predictive").length;
    const factors = panel(page, L.factors.title);
    const findings = page.getByRole("region", { name: L.title, exact: true });

    // The verdicts: how many of the tests pass the pre-registered rule, beside the title and in the findings, with the
    // smallest raw and Holm-adjusted p.
    await expect(factors.getByText(tpl(L.factors.verdict, { passed, tests: tests.length }), { exact: true })).toBeVisible();
    await expect(findings).toContainText(tpl(L.findings.returns.value, { passed, tests: tests.length }));
    const smallest = (values: ReadonlyArray<number | null>) => formatP(Math.min(...values.filter((value): value is number => value !== null)));
    await expect(findings).toContainText(
      tpl(L.findings.returns.body, {
        tests: tests.length,
        factors: RESEARCH.factors.length,
        horizons: RESEARCH.horizons.length,
        minP: smallest(tests.map((result) => result.p)),
        minHolm: smallest(tests.map((result) => result.holmP)),
      }),
    );

    // One row per factor and a column per horizon; each cell has the rank IC, its signs by subperiod, the t on
    // non-overlapping dates, the Newey-West t and the Holm-adjusted p.
    const table = factors.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText([L.factors.factor, ...RESEARCH.horizons.map((days) => tpl(L.factors.horizon, { days }))]);
    const expected = RESEARCH.factors.map((factor) => [
      `${L.factors.names[factor.key]} ${L.factors.defs[factor.key]}`,
      ...RESEARCH.horizons.map((days) => {
        const result = factor.results.find((entry) => entry.days === days)!;
        const signs = result.signs.map((sign) => (sign > 0 ? "+" : sign < 0 ? "−" : "·")).join(" ");
        return [formatIc(result.ic), tpl(L.factors.signs, { signs }), tpl(L.factors.cell, { t: formatT(result.t), nw: formatT(result.allDates.t), holm: formatP(result.holmP) })].join(" ");
      }),
    ]);
    await expect.poll(() => readCells(table), { message: "the factor test cells" }).toEqual(expected);
  });

  test("the track record inks each reading's row, name, return and range only as the evidence rules allow", async ({ page, app }, testInfo) => {
    await app.goto("/lab");
    const track = panel(page, L.track.title);
    const picker = track.getByRole("radiogroup", { name: L.track.horizonName });
    const colors = await tokenColors(track, ["--fg", "--fg-2", "--fg-3", "--up", "--down"] as const);
    expect(new Set(Object.values(colors)).size, "five distinct token colors").toBe(5);
    let greyRows = 0;

    for (const horizon of EVALUATION.horizons) {
      await picker.getByRole("radio", { name: tpl(MESSAGES.en.signal.backtest.hold, { n: horizon.days }), exact: true }).click();
      const table = track.getByRole("table", { name: tpl(L.track.labelsCaption, { days: horizon.days }), exact: true });
      const totalDates = horizon.ic.dates;
      // A reading's row is grey, its name included, when one market stretch holds too much of a rare reading
      // (isConcentrated), and only then; elsewhere the name stands out in --fg. Its return against the same-day universe
      // takes the up or down color only as selectionTone decides, and nothing else in the table takes a price color. The
      // dot of its range is accent only where the range excludes zero on a row that is not grey (components/ui/Whisker).
      const rows = horizon.labels.map((label) => {
        const grey = isConcentrated(label, totalDates);
        if (grey) greyRows++;
        const tone = selectionTone(label, totalDates);
        const range = label.ci.selection;
        return {
          reading: MESSAGES.en.signal.codes[label.code],
          color: grey ? colors["--fg-3"] : colors["--fg-2"],
          readingColor: grey ? colors["--fg-3"] : colors["--fg"],
          value: pct(label.selection, 2, true),
          valueColor: tone === "up" ? colors["--up"] : tone === "down" ? colors["--down"] : grey ? colors["--fg-3"] : colors["--fg"],
          dot: label.selection === null ? "" : grey ? "var(--fg-3)" : range !== null && (range[0] > 0 || range[1] < 0) ? "var(--accent)" : "var(--fg)",
        };
      });
      const priced = rows.filter((row) => row.valueColor === colors["--up"] || row.valueColor === colors["--down"]).length;
      await expect
        .poll(
          () =>
            table.evaluate(
              (element, { heads, priceColors }) => {
                const leaves = (scope: Element) => [...scope.querySelectorAll("*")].filter((node) => node.childElementCount === 0 && (node.textContent ?? "").trim() !== "");
                // The columns by their heads, so a column added or moved cannot shift what is read.
                const names = [...element.querySelectorAll("thead th")].map((head) => (head.textContent ?? "").trim());
                const reading = names.indexOf(heads.reading);
                const selection = names.indexOf(heads.selection);
                if (reading < 0 || selection < 0) return { columns: names };
                const rows = [...element.querySelectorAll("tbody tr")].map((row) => {
                  const nameCell = row.children[reading];
                  const selectionCell = row.children[selection];
                  // The return is the selection cell's figure ("+0.18%"); its interval ("[−0.22%, +0.57%]") is not.
                  const value = selectionCell ? leaves(selectionCell).find((node) => /^[+−]?\d+\.\d{2}%$/.test((node.textContent ?? "").trim())) : undefined;
                  const name = nameCell ? leaves(nameCell)[0] : undefined;
                  return {
                    reading: (nameCell?.textContent ?? "").trim(),
                    color: getComputedStyle(row).color,
                    readingColor: name ? getComputedStyle(name).color : "",
                    value: (value?.textContent ?? "").trim(),
                    valueColor: value ? getComputedStyle(value).color : "",
                    dot: selectionCell?.querySelector("svg[role='img'] circle")?.getAttribute("fill") ?? "",
                  };
                });
                return { rows, priced: leaves(element).filter((node) => priceColors.includes(getComputedStyle(node).color)).length };
              },
              { heads: { reading: L.track.labelCols.reading, selection: L.track.labelCols.selection }, priceColors: [colors["--up"], colors["--down"]] },
            ),
          { message: `the readings at ${horizon.days} sessions` },
        )
        .toEqual({ rows, priced });
    }
    // With the committed file no reading is concentrated, so the grey half of the rule cannot show here; the lab's
    // component test renders a concentrated reading.
    if (greyRows === 0) {
      testInfo.annotations.push({
        type: "no-grey-row",
        description: "No reading of lib/signal-evaluation.json is concentrated at any horizon: components/lab/ReadingTrackPanel.test.ts covers the grey rows.",
      });
    }
    // The legend states the grey-row rule; its wording is being reworked, so only its episode limit is checked.
    await expect(track.getByRole("paragraph").filter({ hasText: pct(EPISODE_SHARE_LIMIT, 0) }).first()).toBeVisible();
  });

  test("the risk calibration shows how often the forecast ranges held", async ({ page, app }) => {
    await app.goto("/lab");
    const risk = panel(page, L.risk.title);
    const bands = CALIBRATION.bands;
    const table = risk.getByRole("table", { name: tpl(L.risk.bands, { days: bands.horizon }), exact: true });
    // The whole period, each subperiod and 20-day volatility alone, then the normal curve for reference.
    const coverage = [
      { period: yearSpan(CALIBRATION.window.from, CALIBRATION.window.to), ...bands.overall },
      ...bands.subperiods.map((row) => ({ period: yearSpan(row.from, row.to), ...row })),
      { period: L.risk.shortOnly, ...bands.shortWindowOnly },
    ];
    await expect
      .poll(async () => (await readCells(table)).map((cells) => cells.join(" ")), { message: "the range coverage rows" })
      .toEqual([...coverage.map((row) => `${row.period} ${pct(row.within1, 1)} ${pct(row.within2, 1)}`), expect.stringMatching(new RegExp(`^${L.risk.normal} `))]);

    // How persistent volatility and beta are, from the same file.
    const persistence = CALIBRATION.persistence;
    for (const [label, figure] of [
      [L.risk.persistenceVol, persistence.volatility],
      [L.risk.persistenceBeta, persistence.beta],
    ] as const) {
      await expect(risk).toContainText(`${label}${formatCorrelation(figure.mean)}${tpl(L.risk.persistenceSub, { min: formatCorrelation(figure.min), t: formatT(figure.t, 1) })}`);
    }
  });
});
