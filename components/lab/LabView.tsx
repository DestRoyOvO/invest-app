"use client";

import { useId, type ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { PanelCode } from "@/components/ui/Panel";
import { DASH, tpl } from "@/lib/format";

import { HindsightPanel, MethodPanel, PowerPanel, RerunPanel } from "./ContextPanels";
import { FACTOR_RESEARCH, RISK_CALIBRATION } from "./data";
import { researchTally } from "./evidence";
import { FactorTestsPanel, RobustnessPanel } from "./FactorTestsPanel";
import { ReadingTrackPanel } from "./ReadingTrackPanel";
import { RiskCalibrationPanel } from "./RiskCalibrationPanel";
import { formatCorrelation, formatP, pct, yearSpan } from "./stats-format";

// The factor lab: everything the app measured about its own numbers, from the committed research files. Column flow:
// the wide factor and track-record tables on the left; risk calibration, power, method and how to re-run on the right.
// Below xl it is one column in DOM order: findings, factor tests, track record, hindsight, risk, power, method.

function Finding({ label, value, title, body }: { label: string; value: ReactNode; title: string; body: string }) {
  return (
    <li className="flex min-w-0 flex-col bg-panel px-4 py-3">
      <span className="col-head">{label}</span>
      <span className="num mt-1 text-figure text-fg">{value}</span>
      <p className="mt-2 text-sm font-medium text-fg">{title}</p>
      <p className="mt-1 text-xs leading-5 text-fg-2">{body}</p>
    </li>
  );
}

function LabHeader() {
  const { t } = usePrefs();
  const l = t.lab;
  const f = l.findings;
  const titleId = useId();
  const research = FACTOR_RESEARCH;
  const calibration = RISK_CALIBRATION;
  const tally = researchTally(research);
  const main = research.bias.universeVsBenchmarks[0] ?? null;
  const power = research.power.find((row) => row.days === 21) ?? research.power[0] ?? null;
  const gap = main && main.universe !== null && main.equalWeight !== null ? main.universe - main.equalWeight : null;

  return (
    <section aria-labelledby={titleId} className="bg-panel xl:col-span-2">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <PanelCode code="LAB" />
          <h1 id={titleId} className="text-lg font-medium text-fg">
            {l.title}
          </h1>
        </div>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-fg-2">{tpl(l.intro, { n: research.universe })}</p>
        <p className="num mt-1 text-xs text-fg-3">
          {tpl(l.provenance, { model: research.model, n: research.universe, from: research.from, to: research.to, hash: research.dataHash })}
        </p>
      </div>
      <h2 className="sr-only">{f.title}</h2>
      <ul className="grid gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <Finding
          label={f.returns.label}
          value={tpl(f.returns.value, { passed: tally.passed, tests: tally.tests })}
          title={f.returns.title}
          body={tpl(f.returns.body, {
            tests: tally.tests,
            factors: research.factors.length,
            horizons: research.horizons.length,
            minP: formatP(tally.minP),
            minHolm: formatP(tally.minHolmP),
          })}
        />
        <Finding
          label={f.risk.label}
          value={formatCorrelation(calibration.persistence.volatility.mean)}
          title={f.risk.title}
          body={tpl(f.risk.body, {
            days: calibration.persistence.horizon,
            vol: formatCorrelation(calibration.persistence.volatility.mean),
            volMin: formatCorrelation(calibration.persistence.volatility.min),
            beta: formatCorrelation(calibration.persistence.beta.mean),
            bandDays: calibration.bands.horizon,
            within1: pct(calibration.bands.overall.within1, 0),
            within2: pct(calibration.bands.overall.within2, 0),
          })}
        />
        <Finding
          label={f.hindsight.label}
          value={pct(gap, 1, true)}
          title={f.hindsight.title}
          body={tpl(f.hindsight.body, {
            n: research.universe,
            universe: pct(main?.universe, 1),
            years: main ? yearSpan(main.from, main.to) : "",
            rsp: pct(main?.equalWeight, 1),
            spy: pct(main?.market, 1),
          })}
        />
        <Finding
          label={tpl(f.power.label, { days: power?.days ?? 21 })}
          value={power?.minimumDetectableIc?.toFixed(3) ?? DASH}
          title={f.power.title}
          body={tpl(f.power.body, { n: research.universe, mde: power?.minimumDetectableIc?.toFixed(3) ?? DASH, days: power?.days ?? 21 })}
        />
      </ul>
    </section>
  );
}

export function LabView() {
  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <LabHeader />
      <div className="flex min-w-0 flex-col gap-px">
        <FactorTestsPanel />
        <RobustnessPanel />
        <ReadingTrackPanel />
        <HindsightPanel />
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <RiskCalibrationPanel />
        <PowerPanel />
        <MethodPanel />
        <RerunPanel />
      </div>
    </div>
  );
}
