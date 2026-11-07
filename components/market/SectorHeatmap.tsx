"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { deltaTint } from "@/components/ui/Delta";
import { stockPath } from "@/lib/api-client";
import { formatCompact, formatPercent, formatPrice } from "@/lib/format";
import { squarify, type TreemapNode } from "@/lib/treemap";
import { getSector } from "@/lib/universe";
import type { Quote, SectorSnapshot } from "@/types/api";

const SECTOR_HEADER = 18;

interface SectorLayout {
  node: TreemapNode<SectorSnapshot>;
  header: number;
  stocks: TreemapNode<Quote>[];
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Market-cap treemap of the sector universe, colored by today's change. */
export function SectorHeatmap({ sectors, className }: { sectors: SectorSnapshot[]; className?: string }) {
  const { lang, theme } = usePrefs();
  const maxMix = theme === "light" ? 80 : 50;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => (Math.abs(current.w - width) < 1 && Math.abs(current.h - height) < 1 ? current : { w: width, h: height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo<SectorLayout[]>(() => {
    if (size.w < 10 || size.h < 10) return [];
    const caps = sectors.flatMap((s) => s.stocks.map((q) => q.marketCap ?? 0)).filter((c) => c > 0);
    const fallbackCap = median(caps);
    const weight = (q: Quote) => (q.marketCap && q.marketCap > 0 ? q.marketCap : fallbackCap);
    const sectorNodes = squarify(
      sectors.filter((s) => s.stocks.length > 0).map((s) => ({ item: s, value: s.stocks.reduce((sum, q) => sum + weight(q), 0) })),
      { x: 0, y: 0, w: size.w, h: size.h },
    );
    return sectorNodes.map((node) => {
      const header = node.h > 70 && node.w > 64 ? SECTOR_HEADER : 0;
      const inner = { x: node.x, y: node.y + header, w: node.w, h: node.h - header };
      const stocks = squarify(
        node.item.stocks.map((q) => ({ item: q, value: weight(q) })),
        inner,
      );
      return { node, header, stocks };
    });
  }, [sectors, size]);

  return (
    <div ref={containerRef} className={className ?? "relative h-[420px] w-full overflow-hidden bg-canvas"}>
      {layout.map(({ node, header, stocks }) => {
        const def = getSector(node.item.key);
        return (
          <div key={node.item.key}>
            {header > 0 ? (
              <Link
                href={`/sector/${node.item.key}`}
                className="absolute flex items-center justify-between gap-2 overflow-hidden bg-panel-2 px-1.5 text-xs text-fg-2 hover:text-fg"
                style={{ left: node.x, top: node.y, width: Math.max(node.w - 1, 0), height: header - 1 }}
              >
                <span className="truncate font-medium">{def?.short[lang] ?? node.item.key}</span>
                <span className="num shrink-0">{formatPercent(node.item.changePercent)}</span>
              </Link>
            ) : null}
            {stocks.map((tile) => {
              const q = tile.item;
              const w = tile.w - 1;
              const h = tile.h - 1;
              const showSymbol = w > 34 && h > 18;
              const showChange = w > 44 && h > 34;
              const large = w > 110 && h > 70;
              const label = `${q.symbol} ${q.name} ${formatPrice(q.price, lang)} ${formatPercent(q.changePercent)} · ${formatCompact(q.marketCap, lang)}`;
              return (
                <Link
                  key={q.symbol}
                  href={stockPath(q.symbol)}
                  aria-label={label}
                  title={label}
                  className="absolute flex flex-col items-center justify-center overflow-hidden text-center leading-tight text-fg outline-offset-[-2px] transition-[filter] hover:brightness-125"
                  style={{ left: tile.x, top: tile.y, width: Math.max(w, 0), height: Math.max(h, 0), background: deltaTint(q.changePercent, 3, maxMix) }}
                >
                  {showSymbol ? <span className={`num font-medium ${large ? "text-base" : "text-xs"}`}>{q.symbol}</span> : null}
                  {showChange ? <span className={`num ${large ? "text-sm" : "text-xs"} opacity-90`}>{formatPercent(q.changePercent)}</span> : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
