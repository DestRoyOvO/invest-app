"use client";

import { useState } from "react";

import { NewsList } from "@/components/news/NewsList";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { useStockNews } from "@/hooks/useQuoteApi";
import { tpl } from "@/lib/format";

const COLLAPSED = 5;

/**
 * Company news first, then industry and macro context; the top five with the rest a click away. With `ready` false
 * the request waits (the page passes the quote's arrival): the news route reuses the quote and profile the page has
 * just loaded instead of loading, and charging for, the same calls in parallel.
 */
export function NewsPanel({ symbol, ready = true, className }: { symbol: string; ready?: boolean; className?: string }) {
  const { t } = usePrefs();
  const { data, error, mutate } = useStockNews(ready ? symbol : null);
  const [expanded, setExpanded] = useState(false);
  const items = data?.news ?? [];

  return (
    <Panel title={t.stock.news} code="NEWS" className={className}>
      <StaleBanner show={Boolean(error && data)} since={data?.asOf} />
      {data ? (
        <NewsList news={items} showProvenance limit={expanded ? undefined : COLLAPSED} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} compact />
      ) : (
        <SkeletonRows rows={COLLAPSED} />
      )}
      {items.length > COLLAPSED ? (
        <div className="border-t border-line px-1.5 py-1">
          <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? t.common.less : tpl(t.stock.newsMore, { n: items.length })}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
