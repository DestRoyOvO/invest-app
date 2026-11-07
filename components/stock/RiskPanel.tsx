"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { bandLayout, horizonMove, quintileRow, rangeOffset, reportWithinHorizon, volatilityQuintile } from "@/components/lab/risk-math";
import { formatBeta, ordinal, pct, yearSpan } from "@/components/lab/stats-format";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Meter } from "@/components/ui/Meter";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, Skeleton, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useFactorProfile, useSignal, useStock } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import type { RiskCalibration } from "@/lib/evaluation";
import { SIGNAL_EVALUATION } from "@/lib/evaluation-data";
import { DASH, formatPrice, formatShortDate, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import riskCalibrationJson from "@/lib/risk-calibration.json";
import type { Lang, SignalRisk } from "@/types/api";

// Risk forecast for one symbol, the quant feature with measured calibration: the expected range over the next
// sessions, forecast volatility, where today's volatility stands against the stock's own year and the universe, beta,
// and how often each volatility quintile fell 10% or more within a month. Readings are neutral: risk is not a gain or
// a loss. lib/risk-calibration.json is loaded here only, where it is shown.

const CALIBRATION = riskCalibrationJson as unknown as RiskCalibration;

type BandKey = "low2" | "low1" | "close" | "high1" | "high2";

/** The ±1σ and ±2σ bands around the reference close on a linear price axis, with the five prices underneath. */
function RangeBand({ risk, t, lang }: { risk: SignalRisk; t: Messages; lang: Lang }) {
  const r = t.risk;
  const layout = bandLayout(risk.price, risk.range1, risk.range2);
  const items: Array<{ key: BandKey; price: number | null }> = [
    { key: "low2", price: risk.range2?.low ?? null },
    { key: "low1", price: risk.range1?.low ?? null },
    { key: "close", price: risk.price },
    { key: "high1", price: risk.range1?.high ?? null },
    { key: "high2", price: risk.range2?.high ?? null },
  ];
  return (
    <div className="mt-3">
      {layout ? (
        <div aria-hidden className="relative h-3">
          <span className="absolute inset-y-0 bg-line-2" style={{ left: `${layout.outer.left}%`, width: `${layout.outer.width}%` }} />
          <span className="absolute inset-y-0 bg-fg-3" style={{ left: `${layout.inner.left}%`, width: `${layout.inner.width}%` }} />
          <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-accent" style={{ left: `${layout.marker}%` }} />
        </div>
      ) : null}
      <dl className="mt-2.5 grid grid-cols-5 gap-1 text-center">
        {items.map((item) => (
          <div key={item.key} className="min-w-0">
            <dt className="text-micro font-medium text-fg-3">{r.bands[item.key]}</dt>
            <dd className={cn("num truncate text-data", item.key === "close" ? "text-fg" : "text-fg-2")}>{formatPrice(item.price, lang)}</dd>
            {item.key !== "close" ? <dd className="num text-micro text-fg-3">{pct(rangeOffset(risk.price, item.price), 1, true)}</dd> : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

function RiskStat({ label, value, sub, meter }: { label: ReactNode; value: ReactNode; sub: ReactNode; meter?: ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2.5">
      <div className="col-head truncate">{label}</div>
      <div className="num mt-1 text-figure text-fg">{value}</div>
      {meter ? <div className="mt-1.5">{meter}</div> : null}
      <div className="mt-1 text-micro text-fg-3">{sub}</div>
    </div>
  );
}

/** Share of months with a fall of 10% or more, quintile by quintile, the stock's quintile marked. */
function QuintileLadder({ quintile, t }: { quintile: number; t: Messages }) {
  const r = t.risk;
  const { overall, threshold } = CALIBRATION.quintiles;
  const max = Math.max(...overall.map((row) => row.drawdown ?? 0), 0.0001);
  return (
    <ol
      aria-label={tpl(r.ladder, { threshold: pct(Math.abs(threshold), 0), years: yearSpan(CALIBRATION.window.from, CALIBRATION.window.to) })}
      className="mt-2.5 space-y-1"
    >
      {overall.map((row) => {
        const current = row.quintile === quintile;
        const extreme = row.quintile === 1 ? r.calmest : row.quintile === overall.length ? r.wildest : null;
        return (
          <li key={row.quintile} className={cn("grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs", current ? "text-fg" : "text-fg-3")}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", current ? "bg-accent" : "bg-transparent")} />
              <span className="num">{tpl(r.ladderRow, { q: row.quintile })}</span>
              {extreme ? <span className="truncate">{extreme}</span> : null}
              {current ? <span className="sr-only">({r.thisStock})</span> : null}
            </span>
            <span aria-hidden className="relative h-1.5 bg-line">
              <span className={cn("absolute inset-y-0 left-0", current ? "bg-fg-2" : "bg-fg-3")} style={{ width: `${((row.drawdown ?? 0) / max) * 100}%` }} />
            </span>
            <span className="num text-right">{pct(row.drawdown, 0)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function QuintileBlock({ quintile, t }: { quintile: number; t: Messages }) {
  const r = t.risk;
  const { overall, threshold } = CALIBRATION.quintiles;
  const row = quintileRow(overall, quintile);
  const calm = quintileRow(overall, 1);
  const wild = quintileRow(overall, overall.length);
  if (!row || !calm || !wild) return null;
  const values = { years: yearSpan(CALIBRATION.window.from, CALIBRATION.window.to), threshold: pct(Math.abs(threshold), 0), drawdown: pct(row.drawdown, 0) };
  const calmest = quintile === 1;
  return (
    <section className="border-t border-line px-3 py-2.5">
      <h3 className="col-head">{tpl(r.quintileTitle, { q: quintile })}</h3>
      <p className="mt-1 text-xs leading-5 text-fg-2">
        {calmest ? tpl(r.quintileCalm, { ...values, wild: pct(wild.drawdown, 0) }) : tpl(r.quintile, { ...values, calm: pct(calm.drawdown, 0) })}
      </p>
      <p className="mt-0.5 text-xs text-fg-3">
        {tpl(calmest ? r.quintileLossCalm : r.quintileLoss, {
          threshold: values.threshold,
          loss: pct(row.loss, 0),
          other: pct((calmest ? wild : calm).loss, 0),
        })}
      </p>
      <QuintileLadder quintile={quintile} t={t} />
    </section>
  );
}

export function RiskPanel({ symbol, className, id }: { symbol: string; className?: string; id?: string }) {
  const { t, lang } = usePrefs();
  const signal = useSignal(symbol);
  const profile = useFactorProfile(symbol);
  const stock = useStock(symbol);
  const r = t.risk;
  const report = signal.data;

  if (!report) {
    return (
      <Panel title={r.title} code="RISK" className={className} id={id}>
        {signal.error ? <ErrorState error={signal.error} onRetry={() => signal.mutate()} /> : <SkeletonRows rows={7} />}
      </Panel>
    );
  }

  const risk = report.status === "ok" ? (report.risk ?? null) : null;
  if (!risk || !risk.range1 || !risk.range2 || risk.price === null || risk.forecastVolatility === null) {
    return (
      <Panel title={r.title} code="RISK" className={className} id={id}>
        <EmptyState>{r.unavailable}</EmptyState>
      </Panel>
    );
  }

  const days = risk.horizonDays;
  const closeDate = report.meta.lastBarDate ? formatShortDate(report.meta.lastBarDate, lang, "UTC") : null;
  const profileSettled = Boolean(profile.data || profile.error);
  const universePercentile = profile.data?.percentiles.volatility ?? null;
  const beta = profile.data?.values.beta ?? risk.beta;
  const quintile = profileSettled ? volatilityQuintile(universePercentile, risk.volatility63, CALIBRATION.quintiles.breakpoints.latest?.values) : null;
  const move = horizonMove(risk.forecastVolatility, days);
  const quote = stock.data?.quote;
  const earningsSoon = quote ? reportWithinHorizon(quote.nextEarningsDate, report.meta.lastBarDate, days) : false;
  const percentileText = (value: number | null) => (value === null ? DASH : tpl(r.percentile, { n: ordinal(value, lang) }));
  const bands = CALIBRATION.bands;
  const universeSize = profile.data?.universeSize ?? SIGNAL_EVALUATION.universe;

  return (
    <Panel
      title={r.title}
      code="RISK"
      actions={closeDate ? <PanelMeta>{tpl(r.meta, { date: closeDate })}</PanelMeta> : null}
      className={className}
      id={id}
    >
      <StaleBanner show={Boolean(signal.error)} since={report.asOf} />
      <section className="px-3 pt-3 pb-3">
        <h3 className="col-head">{tpl(r.rangeTitle, { days })}</h3>
        <RangeBand risk={risk} t={t} lang={lang} />
        {move !== null ? <p className="mt-2.5 text-xs leading-5 text-fg-2">{tpl(r.typical, { days, move: pct(move, 1) })}</p> : null}
      </section>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
        <RiskStat label={r.forecastVol} value={pct(risk.forecastVolatility, 1)} sub={r.forecastVolSub} />
        <RiskStat
          label={r.ownPct}
          value={risk.ownPercentile === null ? DASH : ordinal(risk.ownPercentile, lang)}
          meter={<Meter value={risk.ownPercentile} label={r.ownPct} valueText={percentileText(risk.ownPercentile)} />}
          sub={r.ownPctSub}
        />
        <RiskStat
          label={tpl(r.universePct, { n: universeSize })}
          value={profileSettled ? (universePercentile === null ? DASH : ordinal(universePercentile, lang)) : <Skeleton className="mt-1 h-5 w-10" />}
          meter={<Meter value={universePercentile} label={tpl(r.universePct, { n: universeSize })} valueText={percentileText(universePercentile)} />}
          sub={r.universePctSub}
        />
        <RiskStat label={r.beta} value={profileSettled || beta !== null ? formatBeta(beta) : <Skeleton className="mt-1 h-5 w-10" />} sub={r.betaSub} />
      </div>

      {quintile !== null ? (
        <QuintileBlock quintile={quintile} t={t} />
      ) : profileSettled ? null : (
        <div className="border-t border-line px-3 py-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-2 h-16 w-full" />
        </div>
      )}

      {earningsSoon && quote?.nextEarningsDate ? (
        <p className="flex items-start gap-2 border-t border-line px-3 py-2 text-xs leading-5 text-warn">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          <span>
            {tpl(r.earnings, {
              date: formatShortDate(quote.nextEarningsDate, lang, "America/New_York"),
              estimated: quote.earningsDateEstimated ? r.estimated : "",
              days,
            })}
          </span>
        </p>
      ) : null}

      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        <p>
          {tpl(r.calibration, {
            years: yearSpan(CALIBRATION.window.from, CALIBRATION.window.to),
            within1: pct(bands.overall.within1, 0),
            within2: pct(bands.overall.within2, 0),
            days: bands.horizon,
          })}
        </p>
        <p className="text-fg-2">
          {r.promise}{" "}
          <Link href="/lab#risk" className="whitespace-nowrap text-info underline decoration-info/50 underline-offset-2 hover:decoration-info">
            {r.method}
          </Link>
        </p>
      </div>
    </Panel>
  );
}
