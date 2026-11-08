"use client";

import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import type { FactorHorizonResult, FactorResearch } from "@/lib/evaluation";
import { DASH, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";

import { FACTOR_RESEARCH } from "./data";
import { betaFlips, researchTally } from "./evidence";
import { ScrollRegion } from "./ScrollRegion";
import { formatIc, formatP, formatT, joinList, pct, yearSpan } from "./stats-format";
import { keepSymbols } from "./text";

// Factor tests (#factors): the IC matrix of the pre-registered factors, and the quintile spreads and robustness ICs
// at one horizon. Research statistics are neutral ink; signs show as chips, never as up/down colors.

type ResearchRow = FactorResearch["factors"][number];

function signText(sign: number): string {
  return sign > 0 ? "+" : sign < 0 ? "−" : "·";
}

function SignChips({ signs, label }: { signs: ReadonlyArray<1 | -1 | 0>; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex shrink-0 gap-0.5">
      {signs.map((sign, i) => (
        <span key={i} aria-hidden className="inline-flex size-4 items-center justify-center rounded-xs border border-line-2 text-[0.625rem] leading-none text-fg-2">
          {signText(sign)}
        </span>
      ))}
    </span>
  );
}

function IcCell({ result, t }: { result: FactorHorizonResult; t: Messages }) {
  const l = t.lab.factors;
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-end gap-2">
        <span className="num text-fg">{formatIc(result.ic)}</span>
        <SignChips signs={result.signs} label={tpl(l.signs, { signs: result.signs.map(signText).join(" ") })} />
      </div>
      <div className="num mt-0.5 text-micro text-fg-3">{tpl(l.cell, { t: formatT(result.t), nw: formatT(result.allDates.t), holm: formatP(result.holmP) })}</div>
    </div>
  );
}

/**
 * A horizon picker that sits above a table; its options grow to 40px on phones. `label` is the short visible head,
 * `name` the radiogroup's accessible name, which says which table it changes (the lab has two pickers).
 */
export function HorizonPicker({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span aria-hidden className="col-head">
        {label}
      </span>
      <Segmented label={name} hideLabel size="sm" value={value} options={options} onChange={onChange} className="w-48" />
    </div>
  );
}

export function FactorTestsPanel() {
  const { t, lang } = usePrefs();
  const l = t.lab.factors;
  const research = FACTOR_RESEARCH;
  const tally = researchTally(research);
  const periods = joinList(
    research.subperiods.map((p) => yearSpan(p.from, p.to)),
    lang,
  );

  const columns: DataTableColumn<ResearchRow>[] = [
    {
      key: "factor",
      header: l.factor,
      width: "10rem",
      className: "whitespace-normal!",
      render: (row) => (
        <div className="py-1.5">
          <div className="text-fg">{l.names[row.key]}</div>
          <div className="text-micro text-fg-3">{l.defs[row.key]}</div>
        </div>
      ),
    },
    ...research.horizons.map(
      (days): DataTableColumn<ResearchRow> => ({
        key: `h${days}`,
        header: tpl(l.horizon, { days }),
        align: "right",
        width: "12.5rem",
        render: (row) => {
          const result = row.results.find((r) => r.days === days);
          return result ? <IcCell result={result} t={t} /> : DASH;
        },
      }),
    ),
  ];

  return (
    <Panel title={l.title} id="factors" actions={<Badge>{tpl(l.verdict, { passed: tally.passed, tests: tally.tests })}</Badge>}>
      <p className="max-w-prose px-3 pt-3 pb-2 text-xs leading-5 text-fg-2">{tpl(l.lead, { from: research.from, to: research.to })}</p>
      <ScrollRegion label={l.caption}>
        <DataTable rows={research.factors} columns={columns} rowKey={(row) => row.key} caption={l.caption} minWidth="48rem" className="overflow-x-visible!" />
      </ScrollRegion>
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs">
        <p className="text-fg-2">{tpl(l.rule, { tests: tally.tests, alpha: research.alpha })}</p>
        <p className="text-fg-3">{tpl(l.legend, { tests: tally.tests, periods })}</p>
      </div>
    </Panel>
  );
}

export function RobustnessPanel() {
  const { t, lang } = usePrefs();
  const l = t.lab.robust;
  const names = t.lab.factors.names;
  const research = FACTOR_RESEARCH;
  const [horizon, setHorizon] = useState(String(research.horizons.includes(21) ? 21 : (research.horizons[0] ?? 21)));
  const days = Number(horizon);
  const at = (row: ResearchRow) => row.results.find((r) => r.days === days) ?? null;
  const icCell = (value: number | null | undefined) => <span className="num">{formatIc(value)}</span>;
  const flips = betaFlips(research, days).map((key) => names[key]);

  const columns: DataTableColumn<ResearchRow>[] = [
    { key: "factor", header: l.cols.factor, width: "9.5rem", render: (row) => <span className="text-fg">{names[row.key]}</span> },
    { key: "ic", header: l.cols.ic, align: "right", width: "5rem", render: (row) => icCell(at(row)?.ic) },
    { key: "beta", header: l.cols.beta, align: "right", width: "6rem", render: (row) => icCell(at(row)?.betaAdjustedIc) },
    { key: "sector", header: l.cols.sector, align: "right", width: "7.5rem", render: (row) => icCell(at(row)?.sectorNeutralIc) },
    { key: "winners", header: l.cols.winners, align: "right", width: "6.5rem", render: (row) => icCell(at(row)?.exWinnersIc) },
    { key: "spread", header: l.cols.spread, align: "right", width: "5.5rem", render: (row) => <span className="num">{pct(at(row)?.spread, 2, true)}</span> },
    { key: "spreadT", header: keepSymbols(l.cols.spreadT), align: "right", width: "4rem", render: (row) => <span className="num text-fg-3">{formatT(at(row)?.spreadT)}</span> },
    { key: "turnover", header: l.cols.turnover, align: "right", width: "5.5rem", render: (row) => <span className="num text-fg-3">{pct(at(row)?.turnover, 0)}</span> },
  ];

  return (
    <Panel title={l.title}>
      <HorizonPicker
        label={l.horizon}
        name={l.horizonName}
        value={horizon}
        onChange={setHorizon}
        options={research.horizons.map((h) => ({ value: String(h), label: tpl(t.signal.backtest.hold, { n: h }) }))}
      />
      <ScrollRegion label={tpl(l.caption, { days })}>
        <DataTable
          rows={research.factors}
          columns={columns}
          rowKey={(row) => row.key}
          caption={tpl(l.caption, { days })}
          minWidth="50rem"
          rowClassName={() => "text-fg-2"}
          className="overflow-x-visible!"
        />
      </ScrollRegion>
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs">
        {flips.length > 0 ? <p className="text-fg-2">{tpl(l.flips, { factors: joinList(flips, lang) })}</p> : null}
        <p className="text-fg-3">{tpl(l.legend, { winners: research.bias.exWinners.length })}</p>
      </div>
    </Panel>
  );
}
