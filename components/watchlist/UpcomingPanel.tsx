"use client";

import Link from "next/link";
import { useMemo } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import { ErrorState } from "@/components/ui/States";
import { useCalendar } from "@/hooks/useApi";
import { useNow } from "@/hooks/usePortfolio";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPrice, formatRatio, formatShortDate, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { calendarDaysUntil } from "@/lib/portfolio";
import type { CalendarEvent } from "@/types/api";

import { EARNINGS_WARN_DAYS } from "./format";

const WINDOW_DAYS = 14;

interface UpcomingRow {
  event: CalendarEvent;
  days: number;
}

/** The event kind and its detail line: "Earnings" / "after close · est.", or "Ex-dividend" / "0.26/sh". */
function eventLines(event: CalendarEvent, t: Messages, lang: "en" | "zh"): [string, string] {
  const w = t.watchlist;
  if (event.kind === "dividend") return [w.kindDividend, event.amount !== null ? tpl(w.perShare, { amount: formatPrice(event.amount, lang) }) : ""];
  const timing = event.timing === "pre" ? w.timingPre : event.timing === "post" ? w.timingPost : event.timing === "intraday" ? w.timingIntraday : null;
  return [w.kindEarnings, [timing, event.estimated ? w.est : null].filter(Boolean).join(" · ")];
}

/**
 * Earnings and ex-dividend dates of the held and watched symbols over the next 14 days: date and days left, symbol and
 * the position's weight, and the event, soonest first. The weight sits under the symbol so the event keeps room in the
 * narrow right column of the watchlist page (about 270px at 1280px wide).
 */
export function UpcomingPanel({ symbols, weights, className }: { symbols: readonly string[]; weights: ReadonlyMap<string, number | null>; className?: string }) {
  const { t, lang } = usePrefs();
  const now = useNow();
  const requested = useMemo(() => [...new Set(symbols)].sort(), [symbols]);
  const { data, error, mutate } = useCalendar(requested, WINDOW_DAYS);

  const rows = useMemo<UpcomingRow[]>(() => {
    if (!data || now <= 0) return [];
    const wanted = new Set(requested);
    return data.events
      .filter((e) => e.symbol !== null && wanted.has(e.symbol) && (e.kind === "earnings" || e.kind === "dividend"))
      .map((event) => ({ event, days: calendarDaysUntil(event.at, now) ?? -1 }))
      .filter((r) => r.days >= 0 && r.days <= WINDOW_DAYS);
  }, [data, requested, now]);

  // Chinese dates and the weight label run longer (11月12日, 权重 13.8%).
  const columns: DataTableColumn<UpcomingRow>[] = [
    {
      key: "symbol",
      header: t.columns.symbol,
      width: lang === "zh" ? "5.25rem" : "4.75rem",
      render: (r) => {
        const weight = weights.get(r.event.symbol ?? "") ?? null;
        const pct = formatRatio(weight);
        return (
          <span className="block py-1">
            <span className="mono block truncate font-medium text-fg">{r.event.symbol}</span>
            {weight !== null ? (
              <span className="num block truncate text-micro text-fg-3">
                <span aria-hidden>{tpl(t.watchlist.weightShort, { pct })}</span>
                <span className="sr-only">{`${t.portfolio.weight} ${pct}`}</span>
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "event",
      header: t.watchlist.event,
      render: (r) => {
        const [kind, detail] = eventLines(r.event, t, lang);
        return (
          <span className="block py-1">
            <span className="block truncate text-fg-2">{kind}</span>
            <span className="block truncate text-micro text-fg-3">{detail || "\u00a0"}</span>
          </span>
        );
      },
    },
    {
      key: "when",
      header: t.watchlist.date,
      align: "right",
      width: lang === "zh" ? "5.25rem" : "4.5rem",
      render: (r) => (
        <span className="block py-1">
          <span className="num block text-fg-2">{formatShortDate(r.event.at, lang, "America/New_York")}</span>
          <span className={cn("num block text-micro", r.event.kind === "earnings" && r.days <= EARNINGS_WARN_DAYS ? "text-warn" : "text-fg-3")}>
            {r.days === 0 ? t.watchlist.todayShort : tpl(t.watchlist.daysShort, { n: r.days })}
          </span>
        </span>
      ),
    },
  ];

  return (
    <Panel
      title={t.watchlist.upcoming}
      code="EVTS"
      className={className}
      actions={
        <Link href="/calendar" className="px-1 text-xs text-fg-2 hover:text-fg max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
          {t.watchlist.calendarLink}
        </Link>
      }
    >
      {error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} compact />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.event.id}
          caption={t.watchlist.upcomingCaption}
          rowHref={(r) => stockPath(r.event.symbol ?? "")}
          loading={!data}
          loadingRows={3}
          empty={t.watchlist.upcomingEmpty}
        />
      )}
      <p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{t.watchlist.upcomingMeta}</p>
    </Panel>
  );
}
