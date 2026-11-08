"use client";

import { allocationLegend, holdingGroupLabel } from "@/components/portfolio/labels";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { SkeletonRows } from "@/components/ui/States";
import { formatNumber, formatRatio, tpl } from "@/lib/format";
import { topWeight, type Portfolio } from "@/lib/portfolio";
import { groupExposure, sectorExposure, type ExposureSlice } from "@/lib/portfolio-analytics";
import { holdingGroup, holdingGroupId, type HoldingGroup } from "@/lib/sectors";
import type { Quote } from "@/types/api";
import type { ProfilesResponse } from "@/types/portfolio";

interface AllocationPanelProps {
  portfolio: Portfolio;
  quotes: ReadonlyMap<string, Quote>;
  watchlist: readonly string[];
  profiles: ProfilesResponse | undefined;
  /** Quotes are still loading. */
  loading?: boolean;
  className?: string;
}


/**
 * Allocation by sector or asset class: by position value when positions exist, otherwise by number of watchlist
 * symbols (labelled so). Categorical series colors with legend swatches, and how much the three largest positions hold.
 */
export function AllocationPanel({ portfolio, quotes, watchlist, profiles, loading = false, className }: AllocationPanelProps) {
  const { t, lang } = usePrefs();
  const infoOf = (symbol: string) => ({ quoteType: quotes.get(symbol)?.quoteType ?? null, sector: profiles?.profiles[symbol]?.sector ?? null });
  const byValue = portfolio.rows.length > 0;
  const slices: ExposureSlice<HoldingGroup>[] = byValue
    ? sectorExposure(portfolio.rows, infoOf)
    : groupExposure(
        watchlist.filter((s) => quotes.has(s)),
        (symbol) => {
          const info = infoOf(symbol);
          const group = holdingGroup(symbol, info.quoteType, info.sector);
          return { id: holdingGroupId(group), key: group };
        },
        () => 1,
        (symbol) => symbol,
      );
  const legend = allocationLegend(slices).map((entry) => ({ ...entry, label: entry.key === null ? t.watchlist.other : holdingGroupLabel(entry.key, t, lang) }));
  const top3 = byValue && portfolio.rows.length > 3 ? topWeight(portfolio.rows, 3) : null;

  return (
    <Panel title={t.watchlist.allocation} className={className} actions={loading ? null : <PanelMeta>{byValue ? t.watchlist.byValue : t.watchlist.byCount}</PanelMeta>}>
      {loading ? (
        <SkeletonRows rows={4} />
      ) : legend.length === 0 ? (
        <p className="px-3 py-4 text-sm text-fg-2">{t.watchlist.summaryEmpty}</p>
      ) : (
        <div className="space-y-3 px-3 py-3">
          <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-xs bg-line" aria-hidden>
            {legend.map((slice) => (
              <span key={slice.id} className="h-full" style={{ width: `${slice.weight * 100}%`, background: slice.color }} />
            ))}
          </div>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-1">
            {legend.map((slice) => (
              <li key={slice.id} className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-[1px]" style={{ background: slice.color }} />
                <span className="min-w-0 flex-1 truncate text-fg-2">{slice.label}</span>
                {byValue ? <span className="num hidden text-fg-3 sm:inline">{formatNumber(slice.value, 0, lang)}</span> : null}
                <span className="num w-11 shrink-0 text-right text-fg">{formatRatio(slice.weight, { digits: 0 })}</span>
              </li>
            ))}
          </ul>
          {top3 !== null ? <p className="border-t border-line pt-2 text-xs text-fg-2">{tpl(t.watchlist.concentration, { n: 3, pct: formatRatio(top3, { digits: 0 }) })}</p> : null}
        </div>
      )}
    </Panel>
  );
}
