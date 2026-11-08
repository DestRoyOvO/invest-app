"use client";

import { Info } from "lucide-react";
import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Delta } from "@/components/ui/Delta";
import { withTrueMinus } from "@/components/ui/delta-utils";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { TickNumber } from "@/components/ui/TickNumber";
import { useDiscover } from "@/hooks/useApi";
import { stockPath } from "@/lib/api-client";
import { DASH, formatCompact, formatNumber, formatPrice, formatTime, tpl } from "@/lib/format";
import { displayName, fullName } from "@/lib/names-zh";
import { capParam, DISCOVER_CAPS, ratingKey, relativeVolume, type DiscoverCap } from "@/lib/screens";
import type { DiscoverResponse, DiscoverScreen, Quote } from "@/types/api";

import { earningsText, formatRelativeVolume } from "./display";
import { useWatchToggle } from "./useWatchToggle";
import { WatchStar } from "./WatchStar";

const MOVER_SCREENS = ["day_gainers", "day_losers", "most_actives"] as const;
const IDEA_SCREENS = ["undervalued_large_caps", "growth_technology_stocks", "most_shorted_stocks"] as const;

type MoverScreen = (typeof MOVER_SCREENS)[number];
type IdeaScreen = (typeof IDEA_SCREENS)[number];
type ColumnKey = "symbol" | "name" | "last" | "chg" | "relVol" | "cap" | "pe" | "earnings" | "rating" | "star";

const TABLE_HEIGHT = "min(65vh, 600px)";
/** Panel tabs are 36px; phones get 40px touch targets. */
const PHONE_TABS = "[&_[role=tab]]:max-sm:h-10";

const missing = <span className="text-fg-3">{DASH}</span>;

/** "$300M", "$1B", "$10B", "$100B". */
export function capLabel(cap: DiscoverCap): string {
  return `$${capParam(cap)}`;
}

function useColumns(keys: readonly ColumnKey[], now: number): DataTableColumn<Quote>[] {
  const { t, lang } = usePrefs();
  const { watchlist, toggle } = useWatchToggle();
  const all: Record<ColumnKey, DataTableColumn<Quote>> = {
    symbol: {
      key: "symbol",
      header: t.columns.symbol,
      width: "5rem",
      render: (q) => (
        <span className="mono font-medium text-fg" title={fullName(q.symbol, q.name, lang) ?? undefined}>
          {q.symbol}
        </span>
      ),
      sortValue: (q) => q.symbol,
    },
    name: {
      key: "name",
      header: t.columns.name,
      render: (q) => (
        <span className="text-fg-2" title={q.name}>
          {displayName(q.symbol, q.name, lang)}
        </span>
      ),
      sortValue: (q) => displayName(q.symbol, q.name, lang),
      hideBelow: "sm",
    },
    last: {
      key: "last",
      header: t.columns.last,
      align: "right",
      width: "6.5rem",
      render: (q) => <TickNumber value={q.price}>{formatPrice(q.price, lang)}</TickNumber>,
      sortValue: (q) => q.price,
      hideBelow: "sm",
    },
    chg: {
      key: "chg",
      header: t.columns.changePct,
      align: "right",
      width: "5rem",
      render: (q) => <Delta value={q.changePercent} />,
      sortValue: (q) => q.changePercent,
    },
    relVol: {
      key: "relVol",
      header: t.discover.columns.relVol,
      title: t.discover.relVolHint,
      align: "right",
      width: "5rem",
      render: (q) => <span className="num text-fg">{formatRelativeVolume(relativeVolume(q.volume, q.avgVolume), lang)}</span>,
      sortValue: (q) => relativeVolume(q.volume, q.avgVolume),
      hideBelow: "md",
    },
    cap: {
      key: "cap",
      header: t.columns.marketCap,
      align: "right",
      width: "5.5rem",
      render: (q) => <span className="num text-fg">{formatCompact(q.marketCap, lang)}</span>,
      sortValue: (q) => q.marketCap,
    },
    pe: {
      key: "pe",
      header: t.columns.pe,
      align: "right",
      width: "4rem",
      render: (q) => (q.trailingPE === null ? missing : <span className="num text-fg">{withTrueMinus(formatNumber(q.trailingPE, 1, lang))}</span>),
      sortValue: (q) => q.trailingPE,
      hideBelow: "md",
    },
    earnings: {
      key: "earnings",
      header: t.discover.columns.earnings,
      title: t.discover.earningsHint,
      align: "right",
      width: "6rem",
      render: (q) => {
        const text = earningsText(t, q.nextEarningsDate, q.earningsDateEstimated, now, lang);
        if (!text.long) return missing;
        return (
          <span className="num text-fg" title={text.title ?? undefined}>
            <span aria-hidden>{text.short}</span>
            <span className="sr-only">{text.long}</span>
          </span>
        );
      },
      sortValue: (q) => q.nextEarningsDate,
      firstSort: "asc",
      hideBelow: "lg",
    },
    rating: {
      key: "rating",
      header: t.discover.columns.rating,
      title: t.screener.metricNames.rating,
      align: "right",
      width: "7.5rem",
      render: (q) => {
        const key = ratingKey(q.analystRating);
        if (q.analystRating === null || !key) return missing;
        return (
          <span>
            <span className="num text-fg">{formatNumber(q.analystRating, 1, lang)}</span>
            <span className="ml-1.5 text-fg-3">{t.stock.recommendation[key]}</span>
          </span>
        );
      },
      sortValue: (q) => q.analystRating,
      firstSort: "asc",
      hideBelow: "lg",
    },
    star: {
      key: "star",
      header: <span className="sr-only">{t.screener.star.column}</span>,
      width: "3.25rem",
      align: "center",
      className: "max-sm:px-0",
      render: (q) => <WatchStar symbol={q.symbol} active={watchlist.includes(q.symbol)} onToggle={toggle} />,
    },
  };
  return keys.map((key) => all[key]);
}

interface QuoteListProps {
  data: DiscoverResponse | undefined;
  screen: DiscoverScreen;
  error: unknown;
  onRetry: () => void;
  keys: readonly ColumnKey[];
  caption: string;
  cap: DiscoverCap;
  onCapChange: (cap: DiscoverCap) => void;
}

function QuoteList({ data, screen, error, onRetry, keys, caption, cap, onCapChange }: QuoteListProps) {
  const { t } = usePrefs();
  // keepPreviousData would show the last list under a newly chosen tab or floor; only show rows that match both.
  const current = data && data.screen === screen && data.minMarketCap === cap ? data : undefined;
  const now = current ? Date.parse(current.asOf) : 0;
  const columns = useColumns(keys, now);
  const lower = DISCOVER_CAPS.filter((c) => c < cap);
  if (error && !current) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <>
      <StaleBanner show={Boolean(error && current) || Boolean(current?.quotes.some((q) => q.stale))} since={current?.asOf} />
      <DataTable
        rows={current?.quotes ?? []}
        columns={columns}
        rowKey={(q) => q.symbol}
        caption={tpl(t.discover.caption, { list: caption, n: current?.quotes.length ?? 0 })}
        rowHref={(q) => stockPath(q.symbol)}
        loading={!current}
        loadingRows={8}
        stickyHeader
        maxHeight={TABLE_HEIGHT}
        // The scroll box contains the rows' sr-only text, so rows scrolled out of it do not stretch the page.
        className="relative"
        empty={
          <EmptyState
            actions={
              lower.length > 0 ? (
                <Button size="sm" onClick={() => onCapChange(lower[0])} className="max-sm:h-10">
                  {tpl(t.discover.lowerCap, { cap: capLabel(lower[0]) })}
                </Button>
              ) : undefined
            }
          >
            {tpl(t.discover.empty, { cap: capLabel(cap) })}
          </EmptyState>
        }
      />
    </>
  );
}

/** "50 shown · 250 of 371 scanned · Updated 16:10 ET" for the list on screen, once it matches the tab and floor. */
function ListMeta({ data, screen, cap }: { data: DiscoverResponse | undefined; screen: DiscoverScreen; cap: DiscoverCap }) {
  const { t, lang } = usePrefs();
  if (!data || data.screen !== screen || data.minMarketCap !== cap) return null;
  const counts =
    data.total !== null
      ? tpl(t.discover.shown, { n: data.quotes.length, scanned: data.scanned, total: data.total })
      : tpl(t.discover.shownNoTotal, { n: data.quotes.length, scanned: data.scanned });
  return (
    <span className="num truncate text-micro text-fg-3">
      {counts} · {tpl(t.discover.updated, { time: formatTime(data.asOf, lang, "America/New_York") })}
    </span>
  );
}

function MoversPanel({ cap, onCapChange }: { cap: DiscoverCap; onCapChange: (cap: DiscoverCap) => void }) {
  const { t } = usePrefs();
  const [screen, setScreen] = useState<MoverScreen>("day_gainers");
  const { data, error, mutate } = useDiscover(screen, cap);
  return (
    <Panel title={t.discover.movers} code="MOV">
      <div className="flex flex-wrap items-end justify-between gap-x-3 border-b border-line pl-1">
        <div className="no-scrollbar min-w-0 overflow-x-auto">
          <Tabs
            label={t.discover.moverTabs.label}
            value={screen}
            onChange={setScreen}
            options={MOVER_SCREENS.map((s) => ({ value: s, label: t.discover.moverTabs[s] }))}
            className={PHONE_TABS}
          />
        </div>
        <div className="min-w-0 pr-3 pb-2.5 pl-2">
          <ListMeta data={data} screen={screen} cap={cap} />
        </div>
      </div>
      <QuoteList
        data={data}
        screen={screen}
        error={error}
        onRetry={() => mutate()}
        keys={["symbol", "name", "last", "chg", "relVol", "cap", "earnings", "rating", "star"]}
        caption={t.discover.moverTabs[screen]}
        cap={cap}
        onCapChange={onCapChange}
      />
    </Panel>
  );
}

function IdeasPanel({ cap, onCapChange }: { cap: DiscoverCap; onCapChange: (cap: DiscoverCap) => void }) {
  const { t } = usePrefs();
  const [screen, setScreen] = useState<IdeaScreen>("undervalued_large_caps");
  const { data, error, mutate } = useDiscover(screen, cap);
  return (
    <Panel title={t.discover.ideas}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 border-b border-line pl-1">
        <div className="no-scrollbar min-w-0 overflow-x-auto">
          <Tabs
            label={t.discover.ideaTabs.label}
            value={screen}
            onChange={setScreen}
            options={IDEA_SCREENS.map((s) => ({ value: s, label: t.discover.ideaTabs[s] }))}
            className={PHONE_TABS}
          />
        </div>
        <div className="min-w-0 pr-3 pb-2.5 pl-2">
          <ListMeta data={data} screen={screen} cap={cap} />
        </div>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line px-3 py-2 text-xs text-fg-2">
        <Badge>{t.discover.yahooDefinition}</Badge>
        <span>{t.discover.definitions[screen]}</span>
      </p>
      <QuoteList
        data={data}
        screen={screen}
        error={error}
        onRetry={() => mutate()}
        keys={["symbol", "name", "last", "chg", "cap", "pe", "rating", "earnings", "star"]}
        caption={t.discover.ideaTabs[screen]}
        cap={cap}
        onCapChange={onCapChange}
      />
    </Panel>
  );
}

function TrendingPanel({ cap, onCapChange }: { cap: DiscoverCap; onCapChange: (cap: DiscoverCap) => void }) {
  const { t } = usePrefs();
  const { data, error, mutate } = useDiscover("trending", cap);
  return (
    <Panel title={t.discover.trending}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-3 py-2">
        <p className="text-xs text-fg-2">{t.discover.trendingHint}</p>
      </div>
      <div className="border-b border-line px-3 py-1.5">
        <ListMeta data={data} screen="trending" cap={cap} />
      </div>
      <QuoteList
        data={data}
        screen="trending"
        error={error}
        onRetry={() => mutate()}
        keys={["symbol", "name", "last", "chg", "star"]}
        caption={t.discover.trending}
        cap={cap}
        onCapChange={onCapChange}
      />
    </Panel>
  );
}

function AboutPanel({ cap }: { cap: DiscoverCap }) {
  const { t } = usePrefs();
  return (
    <Panel title={t.discover.source}>
      <div className="flex items-start gap-2 px-3 py-3 text-xs text-fg-2">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} />
        <div className="space-y-2">
          <p>{tpl(t.discover.sourceNote, { cap: capLabel(cap) })}</p>
          <p>{t.discover.moversFloor}</p>
          <p className="text-fg-3">{t.discover.notAdvice}</p>
        </div>
      </div>
    </Panel>
  );
}

/** MOST: Yahoo's market-wide movers, idea lists and trending symbols above a market-cap floor. */
export function DiscoverTab({ cap, onCapChange }: { cap: DiscoverCap; onCapChange: (cap: DiscoverCap) => void }) {
  return (
    <div className="grid gap-px bg-line xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-px">
        <MoversPanel cap={cap} onCapChange={onCapChange} />
        <IdeasPanel cap={cap} onCapChange={onCapChange} />
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <TrendingPanel cap={cap} onCapChange={onCapChange} />
        <AboutPanel cap={cap} />
      </div>
    </div>
  );
}
