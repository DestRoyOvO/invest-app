"use client";

import type { ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { Delta } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { formatCompact, formatDate, formatMultiple, formatNumber, formatPercent, formatPrice, formatRatio, tpl } from "@/lib/format";
import type { KeyStats as KeyStatsData, Quote } from "@/types/api";

import { instrumentKind } from "./quote-utils";

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
      <h3 className="col-head mb-1">{title}</h3>
      <dl className="divide-y divide-line/60">{children}</dl>
    </div>
  );
}

/**
 * Renders "{pct} vs price" / "较现价 {pct}" with the signed gap between the mean target and the price. Neutral ink: a
 * target is an opinion about the future, not a price move.
 */
function Upside({ template, value }: { template: string; value: number }) {
  return <span className="ml-1.5 font-sans text-xs text-fg-3">{tpl(template, { pct: formatPercent(value, { digits: 1 }) })}</span>;
}

type RecommendationKey = "strong_buy" | "buy" | "hold" | "underperform" | "sell" | "none";

/** Two columns of groups between sm and xl, one column in the narrow right stack from xl. */
const GROUP_GRID =
  "grid content-start sm:grid-cols-2 xl:grid-cols-1 [&>*]:border-b [&>*]:border-line [&>*:last-child]:border-b-0 sm:[&>*:nth-child(odd)]:border-r xl:[&>*:nth-child(odd)]:border-r-0";

/**
 * Valuation, profitability, balance sheet and analyst figures (fund figures for ETFs). Margins that do not apply
 * (a bank's gross margin) arrive as null and show a dash; amounts reported in another currency than the price are
 * labelled with that currency. Indices, currencies, futures and crypto have no company or fund figures, earnings or
 * dividends: they get the trading figures alone, with the market cap and volume only where Yahoo has them.
 */
export function KeyStats({ stats, quote, className }: { stats: KeyStatsData; quote: Quote; className?: string }) {
  const { t, lang } = usePrefs();
  const s = t.stock.stats;
  const upside = stats.targetMeanPrice !== null && quote.price ? ((stats.targetMeanPrice - quote.price) / quote.price) * 100 : null;
  const recKey = (stats.recommendationKey ?? "none") as RecommendationKey;
  const recommendation = t.stock.recommendation[recKey] ?? stats.recommendationKey ?? t.stock.recommendation.none;
  const financialCurrency = stats.financialCurrency ?? null;
  const currencyDiffers = financialCurrency !== null && quote.currency !== null && financialCurrency !== quote.currency;
  const kind = instrumentKind(quote.quoteType);
  const isFund = kind === "fund";
  const balanceTitle = currencyDiffers ? `${t.stock.groups.balance} · ${financialCurrency}` : t.stock.groups.balance;
  const avgVolume = stats.avgVolume ?? quote.avgVolume;
  const marketCap = stats.marketCap ?? quote.marketCap;

  if (kind === "other") {
    return (
      <Panel title={t.stock.keyStats} code="FA" className={className}>
        <Group title={t.stock.groups.trading}>
          {marketCap !== null ? <Row label={s.marketCap}>{formatCompact(marketCap, lang)}</Row> : null}
          {avgVolume !== null && avgVolume > 0 ? <Row label={s.avgVolume}>{formatCompact(avgVolume, lang)}</Row> : null}
          <Row label={s.change52w}>
            <Delta value={quote.fiftyTwoWeekChangePercent} digits={1} />
          </Row>
          <Row label={s.ma50}>{formatPrice(quote.fiftyDayAverage, lang)}</Row>
          <Row label={s.ma200}>{formatPrice(quote.twoHundredDayAverage, lang)}</Row>
        </Group>
      </Panel>
    );
  }

  return (
    <Panel
      title={t.stock.keyStats}
      code="FA"
      className={className}
      actions={
        currencyDiffers ? (
          <span title={tpl(t.stock.figuresInTitle, { currency: financialCurrency, trading: quote.currency ?? "" })}>
            <Badge tone="info">{tpl(t.stock.figuresIn, { currency: financialCurrency })}</Badge>
          </span>
        ) : null
      }
      bodyClassName={GROUP_GRID}
    >
      {isFund ? (
        <Group title={t.stock.groups.fund}>
          <Row label={s.netAssets}>{formatCompact(quote.netAssets, lang)}</Row>
          <Row label={s.expenseRatio}>{formatRatio(quote.expenseRatio, { digits: 2 })}</Row>
          <Row label={s.ytdReturn}>
            <Delta value={quote.ytdReturnPercent} />
          </Row>
          <Row label={s.change52w}>
            <Delta value={quote.fiftyTwoWeekChangePercent} />
          </Row>
          <Row label={s.dividendYield}>{formatRatio(stats.dividendYield ?? quote.dividendYield, { digits: 2 })}</Row>
          <Row label={s.ma50}>{formatPrice(quote.fiftyDayAverage, lang)}</Row>
          <Row label={s.ma200}>{formatPrice(quote.twoHundredDayAverage, lang)}</Row>
          <Row label={s.avgVolume}>{formatCompact(avgVolume, lang)}</Row>
        </Group>
      ) : (
        <>
          <Group title={t.stock.groups.valuation}>
            <Row label={s.marketCap}>{formatCompact(marketCap, lang)}</Row>
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
            <Row label={s.ebitdaMargin}>{formatRatio(stats.ebitdaMargin)}</Row>
            <Row label={s.profitMargin}>{formatRatio(stats.profitMargin)}</Row>
            {/* Growth rates are company figures, not price moves: neutral, with their sign. */}
            <Row label={s.revenueGrowth}>{formatRatio(stats.revenueGrowth, { digits: 1, sign: true })}</Row>
            <Row label={s.earningsGrowth}>{formatRatio(stats.earningsGrowth, { digits: 1, sign: true })}</Row>
          </Group>
          <Group title={balanceTitle}>
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
              {stats.targetLowPrice !== null && stats.targetHighPrice !== null ? `${formatPrice(stats.targetLowPrice, lang)} – ${formatPrice(stats.targetHighPrice, lang)}` : formatPrice(null)}
            </Row>
            <Row label={s.consensus}>
              <span className="font-sans">{recommendation}</span>
              {stats.numberOfAnalysts ? <span className="ml-1.5 text-xs text-fg-3">{tpl(s.analysts, { n: stats.numberOfAnalysts })}</span> : null}
            </Row>
          </Group>
        </>
      )}
      {isFund ? null : (
        <Group title={t.stock.groups.trading}>
          <Row label={s.avgVolume}>{formatCompact(avgVolume, lang)}</Row>
          <Row label={s.change52w}>
            <Delta value={quote.fiftyTwoWeekChangePercent} digits={1} />
          </Row>
          <Row label={s.ma50}>{formatPrice(quote.fiftyDayAverage, lang)}</Row>
          <Row label={s.ma200}>{formatPrice(quote.twoHundredDayAverage, lang)}</Row>
        </Group>
      )}
      <Group title={t.stock.groups.events}>
        {isFund ? null : <Row label={s.nextEarnings}>{formatDate(quote.nextEarningsDate ?? stats.nextEarningsDate, lang, "America/New_York")}</Row>}
        <Row label={s.exDividend}>{formatDate(quote.exDividendDate ?? stats.exDividendDate, lang, "UTC")}</Row>
      </Group>
    </Panel>
  );
}
