"use client";

import Link from "next/link";

import { findResearch, nearestHorizon, rawEvidence, researchTally } from "@/components/lab/evidence";
import { formatBeta, formatIc, formatT, ordinal, pct, yearSpan } from "@/components/lab/stats-format";
import { interpolate } from "@/components/lab/text";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Meter } from "@/components/ui/Meter";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useFactorProfile } from "@/hooks/useApi";
import { ApiError } from "@/lib/api-client";
import type { FactorResearch } from "@/lib/evaluation";
import factorResearchJson from "@/lib/factor-research.json";
import { FACTOR_KEYS } from "@/lib/factors";
import { DASH, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import type { StyleFactorKey } from "@/types/api";

// Where one stock stands on the five style factors against the universe, each shown with what the pre-registered
// research measured for it in this universe. Percentiles are descriptive and neutral: a high percentile is not good or
// bad. lib/factor-research.json is loaded here only, where it is shown.

const RESEARCH = factorResearchJson as unknown as FactorResearch;

/** The research horizon the evidence line quotes: 21 sessions, the primary one. */
const EVIDENCE_DAYS = nearestHorizon(RESEARCH.horizons, 21) ?? 21;

function rawText(key: StyleFactorKey, value: number | null, t: Messages): string {
  const raw = t.lab.profile.raw;
  if (value === null) return DASH;
  switch (key) {
    case "momentum":
      return tpl(raw.momentum, { value: pct(value, 1, true) });
    case "reversal":
      return tpl(raw.reversal, { value: pct(value, 1, true) });
    case "high52": {
      const below = 1 - value;
      return below < 0.0005 ? raw.high52At : tpl(raw.high52, { value: pct(below, 1) });
    }
    case "volatility":
      return tpl(raw.volatility, { value: pct(value, 1) });
    case "beta":
      return tpl(raw.beta, { value: formatBeta(value) });
  }
}

function evidenceText(key: StyleFactorKey, t: Messages): string {
  const p = t.lab.profile;
  const found = findResearch(RESEARCH, key, EVIDENCE_DAYS);
  if (!found) return p.noEvidence;
  const { ic, t: tStat } = rawEvidence(found.result, found.direction);
  return tpl(found.result.verdict === "predictive" ? p.predictive : p.notPredictive, { ic: formatIc(ic), t: formatT(tStat), days: EVIDENCE_DAYS });
}

export function FactorProfilePanel({ symbol, className, id }: { symbol: string; className?: string; id?: string }) {
  const { t, lang } = usePrefs();
  const p = t.lab.profile;
  const { data, error, mutate } = useFactorProfile(symbol);

  if (!data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Panel title={p.title} code="FCT" className={className} id={id}>
        {missing ? <EmptyState>{p.unavailable}</EmptyState> : error ? <ErrorState error={error} onRetry={() => mutate()} /> : <SkeletonRows rows={5} />}
      </Panel>
    );
  }

  const n = data.universeSize;
  const tally = researchTally(RESEARCH);
  const mde = RESEARCH.power.find((row) => row.days === EVIDENCE_DAYS)?.minimumDetectableIc ?? null;

  return (
    <Panel title={p.title} code="FCT" actions={<PanelMeta>{tpl(p.meta, { n })}</PanelMeta>} className={className} id={id}>
      <StaleBanner show={Boolean(error)} since={data.asOf} />
      <ul className="divide-y divide-line">
        {FACTOR_KEYS.map((key) => {
          const percentile = data.percentiles[key];
          const name = p.names[key];
          const percentileText = percentile === null ? DASH : tpl(p.percentile, { n: ordinal(percentile, lang) });
          return (
            <li key={key} className="grid gap-x-6 gap-y-2 px-3 py-2.5 sm:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-sm text-fg">{name}</h3>
                <div className="num text-xs text-fg-2">{rawText(key, data.values[key], t)}</div>
                <p className="mt-0.5 text-xs text-fg-3">{p.explain[key]}</p>
              </div>
              <div className="min-w-0 sm:pt-1">
                <div className="flex items-center gap-3">
                  {/* Without a percentile (crypto has no beta against the universe) Meter draws an empty track that says so. */}
                  <div className="flex min-w-0 flex-1">
                    <Meter value={percentile} label={tpl(p.meter, { name, n })} valueText={percentileText} />
                  </div>
                  <span className="num w-24 shrink-0 text-right text-xs text-fg">{percentileText}</span>
                </div>
                <p className="num mt-1.5 text-xs text-fg-3">{evidenceText(key, t)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        {!data.inUniverse ? <p className="text-fg-2">{interpolate(p.notMember, { symbol: <span className="mono text-fg">{data.symbol}</span>, n })}</p> : null}
        <p>
          {tpl(p.foot, {
            n,
            days: EVIDENCE_DAYS,
            years: yearSpan(RESEARCH.window.from, RESEARCH.window.to),
            passed: tally.passed,
            tests: tally.tests,
            mde: mde === null ? DASH : mde.toFixed(3),
          })}{" "}
          <Link href="/lab#factors" className="whitespace-nowrap text-info underline decoration-info/50 underline-offset-2 hover:decoration-info">
            {p.lab}
          </Link>
        </p>
      </div>
    </Panel>
  );
}
