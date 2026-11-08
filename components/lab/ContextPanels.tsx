"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import type { FactorResearch } from "@/lib/evaluation";
import { DASH, formatInteger, tpl } from "@/lib/format";
import { TECHNICAL_FACTORS } from "@/lib/signal";

import { FACTOR_RESEARCH, RISK_CALIBRATION, SIGNAL_EVALUATION } from "./data";
import { readingWeights, researchTally } from "./evidence";
import { ScrollRegion } from "./ScrollRegion";
import { formatWeight, joinList, pct, yearSpan } from "./stats-format";
import { interpolate, listNodes } from "./text";

// Context panels of the factor lab: statistical power, the hindsight in the universe, method and limitations (#method,
// the target of the signal panel's "How it works") and how to regenerate every number.

type PowerRow = FactorResearch["power"][number];

export function PowerPanel() {
  const { t, lang } = usePrefs();
  const l = t.lab.power;
  const columns: DataTableColumn<PowerRow>[] = [
    { key: "horizon", header: l.cols.horizon, render: (row) => tpl(t.lab.track.sessions, { days: row.days }) },
    { key: "dates", header: l.cols.dates, align: "right", width: "4.5rem", render: (row) => <span className="num text-fg-3">{formatInteger(row.dates, lang)}</span> },
    { key: "sd", header: l.cols.sd, align: "right", width: "4.75rem", render: (row) => <span className="num">{row.sdIc?.toFixed(3) ?? DASH}</span> },
    { key: "mde", header: l.cols.mde, align: "right", width: "7rem", render: (row) => <span className="num text-fg">{row.minimumDetectableIc?.toFixed(3) ?? DASH}</span> },
  ];
  return (
    <Panel title={l.title}>
      <DataTable rows={FACTOR_RESEARCH.power} columns={columns} rowKey={(row) => String(row.days)} caption={l.caption} rowClassName={() => "text-fg-2"} />
      <p className="border-t border-line px-3 py-2 text-xs leading-5 text-fg-3">{l.note}</p>
    </Panel>
  );
}

interface GapRow {
  key: string;
  label: string;
  universe: number | null;
  equalWeight: number | null;
  market: number | null;
}

function gap(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

export function HindsightPanel() {
  const { t, lang } = usePrefs();
  const l = t.lab.hindsight;
  const research = FACTOR_RESEARCH;
  const holdout = SIGNAL_EVALUATION.hindsight.holdout;
  const rows: GapRow[] = [
    ...research.bias.universeVsBenchmarks.map((row) => ({ key: `${row.from}:${row.to}`, label: yearSpan(row.from, row.to), ...row })),
    { key: "holdout", label: tpl(l.holdout, { years: yearSpan(holdout.from, holdout.to) }), ...holdout },
  ];
  const ratio = (value: number | null, sign = false) => <span className="num">{pct(value, 1, sign)}</span>;
  const columns: DataTableColumn<GapRow>[] = [
    { key: "period", header: l.cols.period, render: (row) => row.label },
    { key: "universe", header: l.cols.universe, align: "right", width: "5.25rem", render: (row) => <span className="num text-fg">{pct(row.universe, 1)}</span> },
    { key: "rsp", header: l.cols.rsp, align: "right", width: "4rem", render: (row) => ratio(row.equalWeight) },
    { key: "spy", header: l.cols.spy, align: "right", width: "4rem", render: (row) => ratio(row.market) },
    { key: "gapRsp", header: l.cols.gapRsp, align: "right", width: "6rem", render: (row) => ratio(gap(row.universe, row.equalWeight), true) },
    { key: "gapSpy", header: l.cols.gapSpy, align: "right", width: "6rem", render: (row) => ratio(gap(row.universe, row.market), true) },
  ];
  const winners = listNodes(
    research.bias.exWinners.map((w) => (
      <span key={w.symbol} className="whitespace-nowrap">
        <span className="mono text-fg">{w.symbol}</span> {pct(w.annualReturn, 0)}
      </span>
    )),
    lang,
  );
  return (
    <Panel title={l.title}>
      {/* 36rem leaves the period column room for its longest label ("留出样本 2014-2024"). */}
      <ScrollRegion label={l.caption}>
        <DataTable rows={rows} columns={columns} rowKey={(row) => row.key} caption={l.caption} minWidth="36rem" rowClassName={() => "text-fg-2"} className="overflow-x-visible!" />
      </ScrollRegion>
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs leading-5">
        <p className="text-fg-3">{l.note}</p>
        <p className="num text-fg-2">{interpolate(l.winners, { list: winners })}</p>
      </div>
    </Panel>
  );
}

export function MethodPanel() {
  const { t, lang } = usePrefs();
  const l = t.lab.method;
  const evaluation = SIGNAL_EVALUATION;
  const research = FACTOR_RESEARCH;
  const thresholds = evaluation.model.thresholds;
  const weights = joinList(
    readingWeights(evaluation.model.weights, TECHNICAL_FACTORS).map((w) => tpl(l.weight, { name: t.signal.factors[w.key], share: pct(w.share, 0) })),
    lang,
  );
  const estimator = RISK_CALIBRATION.estimator;
  const sections: Array<{ key: string; title: string; body: string }> = [
    {
      key: "reading",
      title: l.readingTitle,
      body: tpl(l.reading, {
        weights,
        strongBullish: thresholds.strongBullish,
        bullish: thresholds.bullish,
        bearish: thresholds.bearish,
        strongBearish: thresholds.strongBearish,
      }),
    },
    {
      key: "evaluation",
      title: l.evaluationTitle,
      body: tpl(l.evaluation, { block: evaluation.settings.bootstrap.blockLength, reps: formatInteger(evaluation.settings.bootstrap.reps, lang) }),
    },
    {
      key: "factors",
      title: l.factorsTitle,
      body: tpl(l.factors, {
        horizons: joinList(
          research.horizons.map((h) => String(h)),
          lang,
        ),
        tests: researchTally(research).tests,
      }),
    },
    {
      key: "risk",
      title: l.riskTitle,
      body: tpl(l.risk, {
        days: RISK_CALIBRATION.bands.horizon,
        wShort: formatWeight(estimator.shortWeight),
        wLong: formatWeight(1 - estimator.shortWeight),
        short: estimator.shortWindow,
        long: estimator.longWindow,
      }),
    },
  ];
  const limits = [tpl(l.limits.hindsight, { n: research.universe }), l.limits.power, l.limits.regime, l.limits.data, l.limits.use];
  return (
    <Panel title={l.title} id="method">
      <div className="space-y-3 px-3 py-3 text-xs leading-5 text-fg-2">
        {sections.map((section) => (
          <section key={section.key}>
            <h3 className="text-sm font-medium text-fg">{section.title}</h3>
            <p className="mt-1">{section.body}</p>
          </section>
        ))}
        <section>
          <h3 className="text-sm font-medium text-fg">{l.limitsTitle}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 marker:text-fg-3">
            {limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </Panel>
  );
}

export function RerunPanel() {
  const { t } = usePrefs();
  const l = t.lab.rerun;
  const evaluationHash = SIGNAL_EVALUATION.data.hash;
  const researchHash = FACTOR_RESEARCH.dataHash;
  const hash = evaluationHash === researchHash ? evaluationHash : `${evaluationHash} · ${researchHash}`;
  return (
    <Panel title={l.title}>
      <div className="space-y-2 px-3 py-3 text-xs leading-5 text-fg-2">
        <pre className="mono overflow-x-auto rounded-xs border border-line bg-panel-2 px-3 py-2 text-xs leading-5 text-fg">
          <code>{"npm run evaluate\nnpm run research -- --offline"}</code>
        </pre>
        <p>{l.body}</p>
        <p className="mono text-fg-3">{tpl(l.hash, { hash })}</p>
      </div>
    </Panel>
  );
}
