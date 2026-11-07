"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta, heatStep, heatStyle } from "@/components/ui/Delta";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPrice, tpl } from "@/lib/format";
import { getSector } from "@/lib/universe";
import type { SectorKey, SectorSnapshot } from "@/types/api";

import { DivergingBar } from "./SectorBars";

/**
 * The heatmap for phones: sectors from best to worst, each a disclosure button that lists its constituents (largest
 * first) as 40px rows, with a heat-colored chip echoing the treemap.
 */
export function SectorList({ sectors, className }: { sectors: SectorSnapshot[]; className?: string }) {
  const { t, lang } = usePrefs();
  const baseId = useId();
  const [open, setOpen] = useState<SectorKey | null>(null);
  const rows = sectors.filter((s) => s.stocks.length > 0).sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
  const maxAbs = Math.max(1, ...rows.map((s) => Math.abs(s.changePercent ?? 0)));

  return (
    <ul className={cn("divide-y divide-line/70", className)}>
      {rows.map((sector) => {
        const label = getSector(sector.key)?.label[lang] ?? sector.key;
        const expanded = open === sector.key;
        const listId = `${baseId}-${sector.key}`;
        return (
          <li key={sector.key}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              onClick={() => setOpen(expanded ? null : sector.key)}
              className="grid min-h-11 w-full grid-cols-[1rem_minmax(0,1fr)_3.5rem_4.5rem] items-center gap-2 px-3 text-left text-data transition-colors hover:bg-hover"
            >
              <ChevronRight aria-hidden className={cn("size-4 text-fg-3 transition-transform", expanded && "rotate-90")} strokeWidth={1.75} />
              <span className="truncate text-fg">{label}</span>
              <DivergingBar change={sector.changePercent} maxAbs={maxAbs} />
              <Delta value={sector.changePercent} className="text-right" />
            </button>
            {expanded ? (
              <ul id={listId} aria-label={tpl(t.markets.heatmap.constituents, { sector: label })} className="border-t border-line/70 pb-1">
                {sector.stocks.map((q) => (
                  <li key={q.symbol}>
                    <Link
                      href={stockPath(q.symbol)}
                      className="grid min-h-10 grid-cols-[0.5rem_3.75rem_minmax(0,1fr)_auto_4.5rem] items-center gap-2 py-1 pr-3 pl-9 text-data transition-colors hover:bg-hover"
                    >
                      <span aria-hidden className="size-2 rounded-[1px]" style={{ background: heatStyle(heatStep(q.changePercent)).background }} />
                      <span className="mono font-medium text-fg">{q.symbol}</span>
                      <span className="truncate text-fg-2">{q.name}</span>
                      <span className="num text-fg">{formatPrice(q.price, lang)}</span>
                      <Delta value={q.changePercent} className="text-right" />
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href={`/sector/${sector.key}`} className="flex min-h-10 items-center gap-1.5 pr-3 pl-9 text-xs text-fg-2 transition-colors hover:text-fg">
                    {tpl(t.markets.heatmap.allStocks, { sector: label })}
                    <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.75} />
                  </Link>
                </li>
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
