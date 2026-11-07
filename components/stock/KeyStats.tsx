"use client";

import type { ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { formatCompact, formatDate, formatMultiple, formatNumber, formatPrice, formatRatio, tpl } from "@/lib/format";
import type { KeyStats as KeyStatsData, Quote } from "@/types/api";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="truncate text-xs text-fg-3">{label}</dt>
      <dd className="num shrink-0 text-right text-data text-fg">{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2">
      <h3 className="label mb-1">{title}</h3>
      <dl className="divide-y divide-line/60">{children}</dl>
    </div>
  );
}

/** Renders a template like "{pct} vs price" / "较现价 {pct}" with a colored percentage in place of {pct}. */
function Upside({ template, value }: { template: string; value: number }) {
  const [before, after = ""] = template.split("{pct}");
  return (
    <span className="ml-1.5 font-sans text-xs text-fg-3">
      {before}
      <Delta value={value} digits={1} />
      {after}
    </span>
  );
}

type RecommendationKey = "strong_buy" | "buy" | "hold" | "underperform" | "sell" | "none";

export function KeyStats({ stats, quote, className }: { stats: KeyStatsData; quote: Quote; className?: string }) {
  const { t, lang } = usePrefs();
  const s = t.stock.stats;
  const upside = stats.targetMeanPrice !== null && quote.price ? ((stats.targetMeanPrice - quote.price) / quote.price) * 100 : null;
  const recKey = (stats.recommendationKey ?? "none") as RecommendationKey;
  const recommendation = t.stock.recommendation[recKey] ?? stats.recommendationKey ?? t.stock.recommendation.none;

  return (
    <Panel title={t.stock.keyStats} className={className} bodyClassName="grid content-start sm:grid-cols-2 xl:grid-cols-1 [&>*]:border-b [&>*]:border-line sm:[&>*:nth-child(odd)]:border-r xl:[&>*:nth-child(odd)]:border-r-0">
      <Group title={t.stock.groups.valuation}>
        <Row label={s.marketCap}>{formatCompact(stats.marketCap ?? quote.marketCap, lang)}</Row>
        <Row label={s.pe}>{formatMultiple(stats.trailingPE ?? quote.trailingPE)}</Row>
        <Row label={s.forwardPe}>{formatMultiple(stats.forwardPE ?? quote.forwardPE)}</Row>
        <Row label={s.peg}>{formatNumber(stats.pegRatio, 2, lang)}</Row>
        <Row label={s.pb}>{formatMultiple(stats.priceToBook)}</Row>
        <Row label={s.eps}>{formatPrice(stats.eps ?? quote.epsTrailingTwelveMonths, lang)}</Row>
        <Row label={s.dividendYield}>{formatRatio(stats.dividendYield ?? quote.dividendYield, { digits: 2 })}</Row>
        <Row label={s.beta}>{formatNumber(stats.beta, 2, lang)}</Row>
      </Group>
      <Group title={t.stock.groups.profitability}>
        <Row label={s.roe}>{formatRatio(stats.roe)}</Row>
        <Row label={s.grossMargin}>{formatRatio(stats.grossMargin)}</Row>
        <Row label={s.operatingMargin}>{formatRatio(stats.operatingMargin)}</Row>
        <Row label={s.profitMargin}>{formatRatio(stats.profitMargin)}</Row>
        <Row label={s.revenueGrowth}>
          <Delta value={stats.revenueGrowth} kind="ratio" digits={1} />
        </Row>
        <Row label={s.earningsGrowth}>
          <Delta value={stats.earningsGrowth} kind="ratio" digits={1} />
        </Row>
      </Group>
      <Group title={t.stock.groups.balance}>
        <Row label={s.cash}>{formatCompact(stats.totalCash, lang)}</Row>
        <Row label={s.debt}>{formatCompact(stats.totalDebt, lang)}</Row>
        <Row label={s.debtToEquity}>{formatNumber(stats.debtToEquity, 2, lang)}</Row>
        <Row label={s.fcf}>{formatCompact(stats.freeCashflow, lang)}</Row>
      </Group>
      <Group title={t.stock.groups.analysts}>
        <Row label={s.target}>
          {formatPrice(stats.targetMeanPrice, lang)}
          {upside !== null ? <Upside template={s.upside} value={upside} /> : null}
        </Row>
        <Row label={s.targetRange}>
          {stats.targetLowPrice !== null && stats.targetHighPrice !== null ? `${formatPrice(stats.targetLowPrice, lang)} – ${formatPrice(stats.targetHighPrice, lang)}` : "—"}
        </Row>
        <Row label={s.consensus}>
          <span className="font-sans">{recommendation}</span>
          {stats.numberOfAnalysts ? <span className="ml-1.5 text-xs text-fg-3">{tpl(s.analysts, { n: stats.numberOfAnalysts })}</span> : null}
        </Row>
        <Row label={s.nextEarnings}>{formatDate(stats.nextEarningsDate, lang, "America/New_York")}</Row>
        <Row label={s.exDividend}>{formatDate(stats.exDividendDate, lang, "UTC")}</Row>
        <Row label={s.avgVolume}>{formatCompact(stats.avgVolume ?? quote.avgVolume, lang)}</Row>
      </Group>
    </Panel>
  );
}
