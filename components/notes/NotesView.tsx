"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { withTrueMinus } from "@/components/ui/delta-utils";
import { useQuoteMap } from "@/hooks/useAlerts";
import { useHydrated } from "@/hooks/useLocalValue";
import { useNotes, useNow } from "@/hooks/useNotes";
import { useWatchlist } from "@/hooks/useWatchlist";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDate, formatPercent, formatPrice, formatRelativeTime, formatShortDate, tpl } from "@/lib/format";
import { compareByReview, levelDistance, notesDueForReview, reviewDaysLeft, tagCounts, thesisExcerpt, type SymbolNote } from "@/lib/notes";
import type { Quote } from "@/types/api";

import { reviewText } from "./format";

interface NoteRow {
  symbol: string;
  note: SymbolNote;
  quote: Quote | undefined;
  days: number | null;
}

const chipClass =
  "inline-flex h-7 items-center gap-1.5 rounded-xs border px-2 text-xs transition-colors max-sm:h-10 max-sm:px-3 aria-pressed:border-accent aria-pressed:text-fg";

/** A target or stop with its signed distance from the price, e.g. "240.00 +28.6%". Neutral: a level is not a move. */
function LevelText({ level, price, className }: { level: number; price: number | null | undefined; className?: string }) {
  const { lang } = usePrefs();
  const distance = levelDistance(level, price);
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      {formatPrice(level, lang)}
      {distance !== null ? <span className="ml-1.5 text-fg-3">{withTrueMinus(formatPercent(distance, { digits: 1 }))}</span> : null}
    </span>
  );
}

function LevelCell({ level, price }: { level: number | null; price: number | null | undefined }) {
  if (level === null) return <span className="text-fg-3">—</span>;
  return <LevelText level={level} price={price} className="text-fg" />;
}

/**
 * Below 1024px, where the target and stop columns are hidden, the thesis cell gets a second line with them (and the
 * last price on phones, where that column is hidden too), so "price vs target and stop" stays on every screen.
 */
function CompactLevels({ row }: { row: NoteRow }) {
  const { t, lang } = usePrefs();
  const words = t.notes.columns;
  const price = row.quote?.price;
  const { target, stop } = row.note;
  if (target === null && stop === null && !price) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs whitespace-nowrap text-fg-3 lg:hidden">
      {price ? (
        <span className="sm:hidden">
          {words.last}{" "}
          <TickNumber value={price} className="text-fg-2">
            {formatPrice(price, lang)}
          </TickNumber>
        </span>
      ) : null}
      {target !== null ? (
        <span>
          {words.target} <LevelText level={target} price={price} className="text-fg-2" />
        </span>
      ) : null}
      {stop !== null ? (
        <span>
          {words.stop} <LevelText level={stop} price={price} className="text-fg-2" />
        </span>
      ) : null}
    </span>
  );
}

function ReviewCell({ row }: { row: NoteRow }) {
  const { t, lang } = usePrefs();
  if (!row.note.reviewBy || row.days === null) return <span className="text-fg-3">—</span>;
  const date = `${row.note.reviewBy}T12:00:00Z`;
  // Due and overdue reviews read as a caveat in words; later ones show the date and the days left.
  if (row.days <= 0) {
    return (
      <span className="num text-warn" title={formatDate(date, lang, "UTC")}>
        {row.days === 0 ? t.notes.dueBadge : reviewText(row.days, t)}
      </span>
    );
  }
  return (
    <span className="num text-fg-2" title={formatDate(date, lang, "UTC")}>
      <span className="max-sm:hidden">{formatShortDate(date, lang, "UTC")} · </span>
      {reviewText(row.days, t)}
    </span>
  );
}

/** /notes (NOTE): every thesis with its levels and review date, overdue reviews first, filterable by tag. */
export function NotesView() {
  const { t, lang } = usePrefs();
  const hydrated = useHydrated();
  const now = useNow();
  const book = useNotes();
  const { symbols: watchlist } = useWatchlist();
  const [tag, setTag] = useState<string | null>(null);
  const symbols = useMemo(() => Object.keys(book), [book]);
  const { quotes, data, error, stale, staleSince, retry } = useQuoteMap(symbols);
  const tags = useMemo(() => tagCounts(book), [book]);
  const activeTag = tag && tags.some((item) => item.tag === tag) ? tag : null;
  const words = t.notes;

  const rows = useMemo<NoteRow[]>(() => {
    const list = Object.entries(book)
      .filter(([, note]) => !activeTag || note.tags.includes(activeTag))
      .map(([symbol, note]) => ({ symbol, note, quote: quotes.get(symbol), days: now ? reviewDaysLeft(note.reviewBy, now) : null }));
    return now ? list.sort((a, b) => compareByReview(a.note, b.note, now) || a.symbol.localeCompare(b.symbol)) : list;
  }, [book, activeTag, quotes, now]);

  const due = now ? notesDueForReview(book, now).length : 0;

  const columns: DataTableColumn<NoteRow>[] = [
    { key: "symbol", header: words.columns.symbol, width: "5.5rem", render: (row) => <span className="mono font-medium text-fg">{row.symbol}</span>, sortValue: (row) => row.symbol },
    {
      key: "thesis",
      header: words.columns.thesis,
      // Two lines of thesis on phones, where the column is narrow, one truncated line from sm up; below lg a second
      // line carries the levels whose columns are hidden.
      className: "max-lg:py-1.5 max-sm:whitespace-normal",
      render: (row) => {
        const excerpt = thesisExcerpt(row.note.thesis, 160);
        return (
          <>
            {excerpt ? (
              <span className="block truncate text-fg-2 max-sm:line-clamp-2 max-sm:whitespace-normal" title={row.note.thesis.slice(0, 600)}>
                {excerpt}
              </span>
            ) : (
              <span className="block truncate text-fg-3">{words.noThesis}</span>
            )}
            <CompactLevels row={row} />
          </>
        );
      },
    },
    {
      key: "conviction",
      header: words.columns.conviction,
      title: words.columns.convictionFull,
      align: "right",
      width: "4.25rem",
      hideBelow: "md",
      render: (row) => (row.note.conviction ? <span className="num text-fg-2">{tpl(words.convictionOf, { n: row.note.conviction })}</span> : <span className="text-fg-3">—</span>),
      sortValue: (row) => row.note.conviction,
    },
    {
      key: "last",
      header: words.columns.last,
      align: "right",
      width: "5.5rem",
      hideBelow: "sm",
      render: (row) => <TickNumber value={row.quote?.price}>{formatPrice(row.quote?.price, lang)}</TickNumber>,
    },
    { key: "target", header: words.columns.target, align: "right", width: "8.5rem", hideBelow: "lg", render: (row) => <LevelCell level={row.note.target} price={row.quote?.price} /> },
    { key: "stop", header: words.columns.stop, align: "right", width: "8.5rem", hideBelow: "lg", render: (row) => <LevelCell level={row.note.stop} price={row.quote?.price} /> },
    { key: "review", header: words.columns.review, width: "9.5rem", render: (row) => <ReviewCell row={row} />, sortValue: (row) => row.days, firstSort: "asc" },
    {
      key: "lastEntry",
      header: words.columns.lastEntry,
      align: "right",
      width: "7rem",
      hideBelow: "xl",
      render: (row) => {
        const entry = row.note.entries[0];
        return entry ? <span className="num text-fg-2">{formatRelativeTime(entry.at, lang, now?.getTime() ?? Date.parse(entry.at))}</span> : <span className="text-fg-3">—</span>;
      },
      sortValue: (row) => row.note.entries[0]?.at ?? null,
    },
  ];

  const count = symbols.length === 1 ? words.countOne : tpl(words.count, { n: symbols.length });
  const starters = watchlist.slice(0, 6).map((symbol) => ({ label: symbol, href: `${stockPath(symbol)}#notes` }));

  return (
    <div className="grid gap-px bg-line p-px">
      <h1 className="sr-only">{words.title}</h1>
      <Panel
        title={words.title}
        code="NOTE"
        actions={
          hydrated && symbols.length > 0 ? (
            <PanelMeta>
              {count}
              {due > 0 ? ` · ${tpl(words.due, { n: due })}` : ""}
            </PanelMeta>
          ) : undefined
        }
      >
        <div className="space-y-2.5 border-b border-line px-3 py-2.5">
          <p className="text-sm text-fg-2">{words.pageIntro}</p>
          {tags.length > 0 ? (
            <div role="group" aria-label={words.filterLabel} className="flex flex-wrap items-center gap-1.5">
              <button type="button" aria-pressed={activeTag === null} onClick={() => setTag(null)} className={cn(chipClass, activeTag === null ? "border-accent text-fg" : "border-line-2 text-fg-2 hover:border-fg-3 hover:text-fg")}>
                {words.allTags}
              </button>
              {tags.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  aria-pressed={activeTag === item.tag}
                  onClick={() => setTag(activeTag === item.tag ? null : item.tag)}
                  className={cn(chipClass, activeTag === item.tag ? "border-accent text-fg" : "border-line-2 text-fg-2 hover:border-fg-3 hover:text-fg")}
                >
                  {item.tag}
                  <span className="num text-fg-3">{item.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <StaleBanner show={stale} since={staleSince} />
        {error && !data ? <ErrorState compact error={error} onRetry={retry} className="border-b border-line" /> : null}
        <DataTable
          rows={hydrated ? rows : []}
          columns={columns}
          rowKey={(row) => row.symbol}
          caption={words.title}
          rowHref={(row) => `${stockPath(row.symbol)}#notes`}
          loading={!hydrated}
          loadingRows={4}
          // A tag filter only lists tags some note carries, so the table is empty only when there are no notes.
          empty={
            <EmptyState chips={starters} chipsLabel={words.emptyChips}>
              {words.emptyAll}
            </EmptyState>
          }
        />
        <p className="border-t border-line px-3 py-2 text-xs text-fg-3">
          {words.exportBefore}{lang === "zh" ? "" : " "}
          <Link href="/data" className="text-fg-2 underline underline-offset-2 hover:text-fg">
            {words.exportLink}
          </Link>
          {words.exportAfter}
        </p>
      </Panel>
    </div>
  );
}
