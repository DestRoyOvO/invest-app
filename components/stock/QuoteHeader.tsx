"use client";

import { Bell, CalendarDays, Coins, PencilLine, Plus, Star } from "lucide-react";
import type { ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { StateDot } from "@/components/shell/MarketClock";
import { AiChip, Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { TickNumber } from "@/components/ui/TickNumber";
import type { Position } from "@/hooks/useHoldings";
import { useChartSeries } from "@/hooks/useQuoteApi";
import { eventDayKey } from "@/lib/events";
import { formatCompact, formatNumber, formatRatio, formatTime, tpl } from "@/lib/format";
import { formatQuotePrice, priceDigits } from "@/lib/quote-figures";
import type { Lang, StockDetail } from "@/types/api";

import { earningsTiming, futureDate, instrumentKind, isUsListing, positionFigures, quoteRanges, rangesNeedBars, upcomingExDividend } from "./quote-utils";
import { perShareDigits } from "./research-utils";
import { RangeBar } from "./RangeBar";

interface QuoteHeaderProps {
  detail: StockDetail;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
  /** The investor's position in this symbol, if any. */
  position?: Position;
  /** The position's share of the portfolio (decimal), when it is in the portfolio's base currency. */
  portfolioWeight?: number | null;
}

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

/** "Thu Nov 12" / "11月12日周四": the date in New York, or the date itself when Yahoo sent one without a time. */
function eventDate(iso: string, lang: Lang): string {
  const date = new Date(`${eventDayKey(iso)}T12:00:00Z`);
  const format = new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (lang === "zh") return format.format(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => format.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("month")} ${part("day")}`;
}

/** A per-share cash amount: 0.27, or up to four decimals for tiny amounts (0.004). */
function perShareAmount(value: number, lang: Lang): string {
  const { min, max } = perShareDigits(value);
  return value.toLocaleString(LOCALES[lang], { minimumFractionDigits: min, maximumFractionDigits: max });
}

function formatShares(shares: number, lang: Lang): string {
  return formatNumber(shares, Number.isInteger(shares) ? 0 : Math.min(4, (String(shares).split(".")[1] ?? "").length), lang);
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2">
      <div className="col-head truncate">{label}</div>
      <div className="num mt-0.5 truncate text-data text-fg">{children}</div>
    </div>
  );
}

function Chip({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-6 items-center gap-1.5 rounded-xs border border-line-2 px-2 text-xs text-fg-2">
      {icon}
      {children}
    </span>
  );
}

/**
 * The quote's headline band: symbol and name, the live price with the day's change and extended hours, the next
 * earnings report and an ex-dividend date within two weeks, the investor's position, and the page's actions.
 */
export function QuoteHeader({ detail, inWatchlist, onToggleWatchlist, position, portfolioWeight = null }: QuoteHeaderProps) {
  const { t, lang } = usePrefs();
  const { openChat, openPositionEditor, openAlertEditor } = useUi();
  const { quote, profile } = detail;
  const symbol = quote.symbol;
  const state = quote.marketState;
  const stateLabel = state ? t.shell.marketState[state] : t.shell.marketState.unknown;
  const figures = position ? positionFigures(position, quote.price, quote.change) : null;
  const a = t.stock.actions;

  const nextEarnings = futureDate(quote.nextEarningsDate);
  const estimated = quote.earningsDateEstimated === true;
  const timing = nextEarnings ? earningsTiming(nextEarnings, isUsListing(symbol)) : null;
  const showExDividend = upcomingExDividend(quote.exDividendDate);
  const kind = instrumentKind(quote.quoteType);
  // A currency pair keeps its pips (EURUSD=X 1.1143), in its price and in its change (USDJPY=X +0.770). Figures Yahoo
  // does not report arrive as null from the server and show as dashes (^VIX and EURUSD=X have no volume), except where
  // the 2Y daily bars the chart loads hold them: ^TNX quotes no open, day range or 52-week low, but its bars have them
  // (quoteRanges).
  const digits = priceDigits(symbol, quote.quoteType);
  const bars = useChartSeries(rangesNeedBars(quote) ? symbol : null, "2y");
  const ranges = quoteRanges(quote, bars.data?.bars ?? null, bars.data?.timezone ?? null);

  const why = () => openChat({ text: tpl(a.whyMovingPrompt, { symbol }), intent: { kind: "move", symbol } });

  return (
    <section aria-label={symbol} className="bg-panel">
      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="mono text-xl font-semibold tracking-tight text-fg">{symbol}</h1>
            <span className="min-w-0 truncate text-sm text-fg-2">{profile.longName ?? quote.name}</span>
            {quote.exchange ? <Badge>{quote.exchange}</Badge> : null}
            {quote.currency && quote.currency !== "USD" ? <Badge tone="info">{quote.currency}</Badge> : null}
            {quote.stale ? (
              <span title={tpl(t.stock.staleTitle, { time: formatTime(quote.fetchedAt, lang) })}>
                <Badge tone="warn">{t.stock.stale}</Badge>
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <TickNumber value={quote.price} className="text-display font-medium text-fg">
              {formatQuotePrice(quote.price, digits, lang)}
            </TickNumber>
            <TickNumber value={quote.change}>
              <Delta value={quote.change} kind="change" digits={digits ?? undefined} lang={lang} className="text-base" />
            </TickNumber>
            <TickNumber value={quote.changePercent}>
              <Delta value={quote.changePercent} arrow className="text-base" />
            </TickNumber>
            <span className="flex items-center gap-1.5 text-xs text-fg-3">
              <StateDot state={state} />
              {stateLabel}
              {quote.regularMarketTime ? <span className="num">· {tpl(t.stock.asOfTime, { time: formatTime(quote.regularMarketTime, lang, "America/New_York") })}</span> : null}
            </span>
          </div>
          {quote.extendedSession && quote.extendedPrice !== null ? (
            <div className="mt-1 flex items-baseline gap-2 text-sm text-fg-3">
              <span>{quote.extendedSession === "PRE" ? t.stock.preMarket : t.stock.afterHours}</span>
              <TickNumber value={quote.extendedPrice} className="text-fg-2">
                {formatQuotePrice(quote.extendedPrice, digits, lang)}
              </TickNumber>
              <Delta value={quote.extendedChangePercent} />
            </div>
          ) : null}
          {nextEarnings || showExDividend ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {nextEarnings ? (
                <Chip icon={<CalendarDays aria-hidden className="size-3.5 text-fg-3" strokeWidth={1.75} />}>
                  {[tpl(t.stock.events.reports, { date: eventDate(nextEarnings, lang) }), timing ? t.stock.events.timing[timing] : null, estimated ? t.stock.events.estimated : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Chip>
              ) : null}
              {showExDividend && quote.exDividendDate ? (
                <Chip icon={<Coins aria-hidden className="size-3.5 text-fg-3" strokeWidth={1.75} />}>
                  {quote.dividendAmount !== null
                    ? tpl(t.stock.events.exDividendAmount, { date: eventDate(quote.exDividendDate, lang), amount: perShareAmount(quote.dividendAmount, lang) })
                    : tpl(t.stock.events.exDividend, { date: eventDate(quote.exDividendDate, lang) })}
                </Chip>
              ) : null}
            </div>
          ) : null}
        </div>

        <div role="group" aria-label={tpl(a.label, { symbol })} className="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
          <Button
            size="sm"
            onClick={onToggleWatchlist}
            aria-pressed={inWatchlist}
            title={tpl(a.withKey, { label: inWatchlist ? t.stock.inWatchlist : t.stock.addToWatchlist, key: "A" })}
          >
            <Star aria-hidden className={inWatchlist ? "size-3.5 text-accent" : "size-3.5"} strokeWidth={1.75} fill={inWatchlist ? "currentColor" : "none"} />
            {inWatchlist ? t.stock.inWatchlist : t.stock.addToWatchlist}
          </Button>
          <Button size="sm" onClick={() => openPositionEditor(symbol)} title={tpl(a.withKey, { label: position ? a.editPosition : a.addPosition, key: "P" })}>
            {position ? <PencilLine aria-hidden className="size-3.5" strokeWidth={1.75} /> : <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />}
            {position ? a.editPosition : a.addPosition}
          </Button>
          <Button size="sm" onClick={() => openAlertEditor(symbol)} title={tpl(a.withKey, { label: a.setAlert, key: "!" })}>
            <Bell aria-hidden className="size-3.5" strokeWidth={1.75} />
            {a.setAlert}
          </Button>
          <Button size="sm" onClick={why} title={tpl(a.withKey, { label: a.whyMoving, key: "W" })}>
            <AiChip tone="current" />
            {a.whyMoving}
          </Button>
        </div>
      </div>

      {figures ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-sm">
          <span className="col-head">{t.stock.position.label}</span>
          <span className="num text-fg">{tpl(t.stock.position.shares, { shares: formatShares(figures.shares, lang), cost: formatQuotePrice(figures.cost, digits, lang) })}</span>
          <span className="text-fg-3" aria-hidden>
            ·
          </span>
          <span className="text-fg-3">
            {t.stock.position.value}{" "}
            <TickNumber value={figures.value} className="text-fg">
              {formatNumber(figures.value, 2, lang)}
            </TickNumber>
          </span>
          {figures.dayPnl !== null ? (
            <>
              <span className="text-fg-3" aria-hidden>
                ·
              </span>
              <span className="text-fg-3">
                {t.stock.position.today}{" "}
                <TickNumber value={figures.dayPnl}>
                  <Delta value={figures.dayPnl} kind="change" lang={lang} />
                </TickNumber>
              </span>
            </>
          ) : null}
          <span className="text-fg-3" aria-hidden>
            ·
          </span>
          <span className="text-fg-3">
            {t.stock.position.total}{" "}
            <TickNumber value={figures.pnl}>
              <Delta value={figures.pnl} kind="change" lang={lang} />
            </TickNumber>{" "}
            (<Delta value={figures.pnlPct} kind="ratio" digits={1} />)
          </span>
          {portfolioWeight !== null ? (
            <>
              <span className="text-fg-3" aria-hidden>
                ·
              </span>
              <span className="num text-fg-2">{tpl(t.stock.position.weight, { pct: formatRatio(portfolioWeight, { digits: 0 }) })}</span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t.stock.stats.open}>{formatQuotePrice(ranges.open, digits, lang)}</Stat>
        <Stat label={t.stock.stats.prevClose}>{formatQuotePrice(quote.previousClose, digits, lang)}</Stat>
        <Stat label={t.stock.stats.volume}>{formatCompact(quote.volume, lang)}</Stat>
        {/* Market cap (stocks, crypto), net assets (funds), or the 52-week change where neither exists (indices, currencies, futures). */}
        {quote.marketCap !== null || kind === "equity" ? (
          <Stat label={t.stock.stats.marketCap}>{formatCompact(quote.marketCap, lang)}</Stat>
        ) : kind === "fund" ? (
          <Stat label={t.stock.stats.netAssets}>{formatCompact(quote.netAssets, lang)}</Stat>
        ) : (
          <Stat label={t.stock.stats.change52w}>
            <Delta value={quote.fiftyTwoWeekChangePercent} digits={1} />
          </Stat>
        )}
        <div className="min-w-0 bg-panel px-3 py-2">
          <div className="col-head truncate">{t.stock.stats.dayRange}</div>
          <RangeBar low={ranges.dayLow} high={ranges.dayHigh} value={quote.price} digits={digits} lang={lang} />
        </div>
        <div className="min-w-0 bg-panel px-3 py-2">
          <div className="col-head truncate">{t.stock.stats.range52w}</div>
          <RangeBar low={ranges.low52} high={ranges.high52} value={quote.price} digits={digits} lang={lang} />
        </div>
      </div>
    </section>
  );
}
