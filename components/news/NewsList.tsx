"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { formatDate, formatRelativeTime } from "@/lib/format";
import type { NewsItem } from "@/types/api";

interface NewsListProps {
  news: NewsItem[];
  showProvenance?: boolean;
  limit?: number;
  /** Two columns on extra-wide screens (the list is trimmed to an even count so the grid stays full). */
  twoColumn?: boolean;
  /** The news source failed, so an empty list means "unavailable" rather than "no headlines". */
  unavailable?: boolean;
}

/** Headline list; clicking opens the news reader drawer. */
export function NewsList({ news, showProvenance = false, limit, twoColumn = false, unavailable = false }: NewsListProps) {
  const { t, lang } = usePrefs();
  const { openNews } = useUi();
  let items = limit ? news.slice(0, limit) : news;
  if (twoColumn && items.length > 1 && items.length % 2 === 1) items = items.slice(0, -1);

  if (items.length === 0) return <EmptyState>{unavailable ? t.common.dataUnavailable : t.news.empty}</EmptyState>;

  return (
    <ul className={twoColumn ? "grid gap-px bg-line/70 xl:grid-cols-2" : "divide-y divide-line/70"}>
      {items.map((item) => (
        <li key={item.id} className={twoColumn ? "bg-panel" : undefined}>
          <button type="button" onClick={() => openNews(item)} className="block h-full w-full px-3 py-2.5 text-left transition-colors hover:bg-hover">
            <span className="line-clamp-2 text-sm leading-snug text-fg">{item.title}</span>
            <span className="mt-1 flex items-center gap-2 text-xs text-fg-3">
              {showProvenance ? <Badge className="h-4 px-1 text-[0.6875rem]">{t.stock.provenance[item.provenance]}</Badge> : null}
              {item.publisher ? <span className="truncate">{item.publisher}</span> : null}
              {item.publishedAt ? (
                <time dateTime={item.publishedAt} title={formatDate(item.publishedAt, lang)} className="num shrink-0">
                  {formatRelativeTime(item.publishedAt, lang)}
                </time>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
