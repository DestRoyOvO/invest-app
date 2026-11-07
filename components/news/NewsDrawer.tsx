"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { ResearchNoteBody } from "@/components/ai/ResearchNote";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { stockPath } from "@/lib/api-client";
import { formatDate, formatRelativeTime } from "@/lib/format";
import type { AnalyzeRequest } from "@/types/api";

/** Headline reader with an on-demand AI analysis (never starts a paid request automatically). */
export function NewsDrawer() {
  const { t, lang } = usePrefs();
  const { newsItem, closeNews } = useUi();

  const request = useMemo<AnalyzeRequest | null>(
    () => (newsItem ? { kind: "news", newsId: newsItem.id, link: newsItem.link, title: newsItem.title, lang } : null),
    [newsItem, lang],
  );

  return (
    <Drawer open={newsItem !== null} onClose={closeNews} title={t.news.title} widthClassName="sm:w-[520px]">
      {newsItem ? (
        <article className="flex min-h-full flex-col">
          <div className="space-y-3 border-b border-line p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
              <Badge>{t.stock.provenance[newsItem.provenance]}</Badge>
              {newsItem.publisher ? <span className="text-fg-2">{newsItem.publisher}</span> : null}
              {newsItem.publishedAt ? (
                <time dateTime={newsItem.publishedAt} title={formatDate(newsItem.publishedAt, lang)}>
                  {formatRelativeTime(newsItem.publishedAt, lang)}
                </time>
              ) : null}
            </div>
            <h3 className="text-lg leading-snug font-medium text-fg">{newsItem.title}</h3>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={newsItem.link}
                target="_blank"
                rel="noopener noreferrer"
                title={t.news.opensExternal}
                className="inline-flex items-center gap-1 text-sm text-info hover:underline"
              >
                {t.news.readOriginal}
                <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.75} />
              </a>
              {newsItem.relatedTickers.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-fg-3">{t.news.related}</span>
                  {newsItem.relatedTickers.slice(0, 8).map((symbol) => (
                    <Link key={symbol} href={stockPath(symbol)} onClick={closeNews} className="num rounded-xs border border-line-2 px-1.5 py-0.5 text-fg-2 hover:bg-hover hover:text-fg">
                      {symbol}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="label px-4 pt-3">{t.news.analyze}</div>
          <ResearchNoteBody request={request} className="flex-1" />
        </article>
      ) : null}
    </Drawer>
  );
}
