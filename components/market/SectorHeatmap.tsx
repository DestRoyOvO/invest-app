"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { heatStep, heatStyle, withTrueMinus } from "@/components/ui/Delta";
import { placeFloating, type Box } from "@/components/ui/floating";
import { EmptyState } from "@/components/ui/States";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import type { Rect } from "@/lib/treemap";
import { getSector } from "@/lib/universe";
import type { OverviewQuote, SectorSnapshot } from "@/types/api";

import { clipBox, headerLabel, layoutHeatmap, nextInDirection, tileLabel, type Direction, type TileLabel } from "./heatmap-layout";
import { SectorCard, StockCard } from "./HeatmapCards";
import { SectorList } from "./SectorList";

type HeatNode =
  | { kind: "sector"; key: string; rect: Rect; sector: SectorSnapshot; href: string; label: { showLabel: boolean; showChange: boolean } }
  | { kind: "stock"; key: string; rect: Rect; quote: OverviewQuote; sector: SectorSnapshot; href: string; label: TileLabel };

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function changeText(value: number | null): string {
  return withTrueMinus(formatPercent(value));
}

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** The on-screen part of an element: inside the viewport and every ancestor that scrolls or clips. Null when hidden. */
function visibleBox(element: HTMLElement): Box | null {
  const clips: Box[] = [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }];
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") clips.push(boxOf(node));
  }
  return clipBox(boxOf(element), clips);
}

interface SectorHeatmapProps {
  sectors: SectorSnapshot[];
  /** Sector header strips; a sector page names its sector already and turns them off. */
  headers?: boolean;
  /** Below sm, show the sector list with expandable constituents instead of the treemap. */
  phoneList?: boolean;
  /** Size of the treemap box, e.g. "min-h-[420px] flex-1" to fill a panel or "h-[320px]". */
  treemapClassName?: string;
}

/**
 * Market-cap treemap of the sector universe, colored by today's change on the stepped heat scale. The tiles form one
 * listbox with a single tab stop: arrow keys move between rectangles, Enter opens the quote (or the sector page from a
 * header strip), and a card with the details follows the mouse or the keyboard.
 */
export function SectorHeatmap({ sectors, headers = true, phoneList = false, treemapClassName = "min-h-[420px] flex-1" }: SectorHeatmapProps) {
  const { t } = usePrefs();
  const hasStocks = sectors.some((sector) => sector.stocks.length > 0);
  if (!hasStocks) return <EmptyState>{t.common.dataUnavailable}</EmptyState>;
  return (
    <>
      {phoneList ? <SectorList sectors={sectors} className="sm:hidden" /> : null}
      <Treemap sectors={sectors} headers={headers} className={cn(treemapClassName, phoneList && "max-sm:hidden")} />
    </>
  );
}

function Treemap({ sectors, headers, className }: { sectors: SectorSnapshot[]; headers: boolean; className?: string }) {
  const { t, lang } = usePrefs();
  const router = useRouter();
  const baseId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  /** The listbox has keyboard focus (focus-visible), so the active node shows a ring and its card. */
  const [keyboard, setKeyboard] = useState(false);
  /** Escape closed the card for this node; moving to another node opens it again. */
  const [dismissed, setDismissed] = useState<string | null>(null);

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

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const nodes = useMemo<HeatNode[]>(() => {
    const caps = sectors.flatMap((s) => s.stocks.map((q) => q.marketCap ?? 0)).filter((cap) => cap > 0);
    const fallbackCap = median(caps);
    const bySector = new Map(sectors.map((sector) => [sector.key, sector]));
    const placed = layoutHeatmap(
      sectors.map((sector) => ({
        key: sector.key,
        items: sector.stocks.map((quote) => ({ item: quote, weight: quote.marketCap && quote.marketCap > 0 ? quote.marketCap : fallbackCap })),
      })),
      size.w,
      size.h,
      { headers },
    );
    const out: HeatNode[] = [];
    for (const box of placed) {
      const sector = bySector.get(box.key as SectorSnapshot["key"]);
      if (!sector) continue;
      if (box.header > 0) {
        const short = getSector(sector.key)?.short[lang] ?? sector.key;
        out.push({
          kind: "sector",
          key: `s:${sector.key}`,
          rect: { x: box.x, y: box.y, w: box.w, h: box.header - 1 },
          sector,
          href: `/sector/${sector.key}`,
          label: headerLabel(box.w, short, changeText(sector.changePercent)),
        });
      }
      for (const tile of box.tiles) {
        if (tile.w < 1 || tile.h < 1) continue;
        out.push({
          kind: "stock",
          key: `t:${tile.item.symbol}`,
          rect: { x: tile.x, y: tile.y, w: tile.w, h: tile.h },
          quote: tile.item,
          sector,
          href: stockPath(tile.item.symbol),
          label: tileLabel(tile.w, tile.h, tile.item.symbol, changeText(tile.item.changePercent)),
        });
      }
    }
    return out;
  }, [sectors, size, headers, lang]);

  const indexOf = useMemo(() => new Map(nodes.map((node, index) => [node.key, index])), [nodes]);
  const activeIndex = activeKey !== null && indexOf.has(activeKey) ? (indexOf.get(activeKey) as number) : nodes.length > 0 ? 0 : -1;
  const active = activeIndex >= 0 ? nodes[activeIndex] : null;
  const nodeId = (index: number) => `${baseId}-n${index}`;

  // The card shows the hovered node, or the active node while the keyboard is in the heatmap.
  const cardNode = (hoverKey !== null && indexOf.has(hoverKey) ? nodes[indexOf.get(hoverKey) as number] : null) ?? (keyboard ? active : null);
  const cardOpen = cardNode !== null && cardNode.key !== dismissed;
  const cardId = `${baseId}-card`;

  const open = useCallback(
    (href: string, newTab: boolean) => {
      if (newTab) window.open(href, "_blank", "noopener");
      else router.push(href);
    },
    [router],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (nodes.length === 0) return;
    let next: number | null = null;
    const direction = ARROWS[event.key];
    if (direction) next = activeIndex < 0 ? 0 : nextInDirection(nodes.map((node) => node.rect), activeIndex, direction);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = nodes.length - 1;
    else if ((event.key === "Enter" || event.key === " ") && active) {
      event.preventDefault();
      open(active.href, event.metaKey || event.ctrlKey);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActiveKey(nodes[next].key);
    setHoverKey(null);
    setDismissed(null);
    setKeyboard(true);
    // aria-activedescendant moves no focus, so the browser does not scroll: bring the tile into view (the page scrolls
    // when the treemap is taller than the screen), and the card then attaches to it.
    document.getElementById(nodeId(next))?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.currentTarget.matches(":focus-visible")) setKeyboard(true);
  };

  const onNodeClick = (event: MouseEvent<HTMLDivElement>, node: HeatNode) => {
    setActiveKey(node.key);
    open(node.href, event.metaKey || event.ctrlKey);
  };

  const onNodePointerEnter = (event: PointerEvent<HTMLDivElement>, node: HeatNode) => {
    // Touch screens get no hover card: a tap opens the quote straight away.
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setHoverKey(node.key);
      setDismissed(null);
    }, hoverKey === null ? 200 : 0);
  };

  const scheduleHoverEnd = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHoverKey(null), 100);
  };

  // Place the card next to its node before paint, and follow scrolling and resizing while it is open. The card attaches
  // to the part of the tile that is on screen and hides while the tile is scrolled out of view, instead of sticking to
  // the edge of the window away from its tile.
  useLayoutEffect(() => {
    if (!cardOpen || !cardNode) return;
    const index = indexOf.get(cardNode.key);
    const place = () => {
      const anchor = index === undefined ? null : document.getElementById(nodeId(index));
      const card = cardRef.current;
      if (!anchor || !card) return;
      const box = visibleBox(anchor);
      if (!box) {
        card.style.visibility = "hidden";
        return;
      }
      const position = placeFloating(box, { width: card.offsetWidth, height: card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, "top");
      card.style.transform = `translate(${Math.round(position.x)}px, ${Math.round(position.y)}px)`;
      card.style.visibility = "visible";
    };
    place();
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // Escape closes only the card (WCAG 1.4.13); listening in the capture phase keeps a surrounding drawer open.
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setDismissed(cardNode.key);
      setHoverKey(null);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("keydown", onEscape, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("keydown", onEscape, true);
    };
    // nodeId depends only on baseId; cardNode changes with every refresh of the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardOpen, cardNode, indexOf]);

  const describedBy = `${baseId}-keys`;

  return (
    <div className={cn("relative w-full overflow-hidden bg-canvas", className)}>
      <span id={describedBy} className="sr-only">
        {t.markets.heatmap.keys}
      </span>
      <div
        ref={containerRef}
        role="listbox"
        aria-label={t.markets.heatmap.label}
        aria-describedby={describedBy}
        aria-activedescendant={keyboard && active ? nodeId(activeIndex) : undefined}
        tabIndex={nodes.length > 0 ? 0 : -1}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={() => setKeyboard(false)}
        onPointerLeave={scheduleHoverEnd}
        className="absolute inset-0 focus-visible:outline-offset-[-2px]"
      >
        {nodes.map((node, index) => {
          const isActive = keyboard && index === activeIndex;
          const ring = isActive ? { outline: "2px solid var(--fg)", outlineOffset: "-2px", boxShadow: "inset 0 0 0 3px var(--canvas)", zIndex: 1 } : undefined;
          const position = { left: node.rect.x, top: node.rect.y, width: node.rect.w, height: node.rect.h };
          const describe = cardOpen && cardNode?.key === node.key ? cardId : undefined;
          if (node.kind === "sector") {
            const short = getSector(node.sector.key)?.short[lang] ?? node.sector.key;
            const change = changeText(node.sector.changePercent);
            return (
              <div
                key={node.key}
                id={nodeId(index)}
                role="option"
                aria-selected={isActive}
                aria-label={`${short} ${change}`}
                aria-describedby={describe}
                onClick={(event) => onNodeClick(event, node)}
                onAuxClick={(event) => event.button === 1 && open(node.href, true)}
                onPointerEnter={(event) => onNodePointerEnter(event, node)}
                className="absolute flex cursor-pointer items-center justify-between gap-1.5 overflow-hidden bg-panel-2 px-1.5 text-micro text-fg-2 select-none hover:text-fg"
                style={{ ...position, ...ring }}
              >
                {node.label.showLabel ? <span className="truncate font-medium">{short}</span> : null}
                {/* A real space, so the text reads "Tech 0.00%" like the aria-label; a flex container draws nothing for it. */}
                {" "}
                {node.label.showChange ? <span className="num shrink-0">{change}</span> : null}
              </div>
            );
          }
          const { quote, label } = node;
          const change = changeText(quote.changePercent);
          return (
            <div
              key={node.key}
              id={nodeId(index)}
              role="option"
              aria-selected={isActive}
              aria-label={`${quote.symbol} ${change}`}
              aria-describedby={describe}
              onClick={(event) => onNodeClick(event, node)}
              onAuxClick={(event) => event.button === 1 && open(node.href, true)}
              onPointerEnter={(event) => onNodePointerEnter(event, node)}
              className="absolute flex cursor-pointer flex-col items-center justify-center overflow-hidden text-center leading-[1.15] select-none hover:shadow-[inset_0_0_0_1px_var(--fg),inset_0_0_0_2px_var(--canvas)]"
              style={{ ...position, ...heatStyle(heatStep(quote.changePercent)), ...ring }}
            >
              {label.showSymbol ? (
                <span className="mono font-medium" style={{ fontSize: label.fontSize }}>
                  {quote.symbol}
                </span>
              ) : null}
              {/* As in the header strips: the text reads "CSCO 0.00%" like the aria-label, not "CSCO0.00%". */}
              {" "}
              {label.showChange ? (
                <span className="num" style={{ fontSize: label.changeSize }}>
                  {change}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {cardOpen && cardNode
        ? createPortal(
            <div
              ref={cardRef}
              id={cardId}
              role="tooltip"
              onPointerEnter={() => window.clearTimeout(hoverTimer.current)}
              onPointerLeave={scheduleHoverEnd}
              style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
              className="z-[70] w-72 max-w-[calc(100vw-1rem)] rounded-xs border border-line-2 bg-panel-2 p-3 text-sm text-fg shadow-xl"
            >
              {cardNode.kind === "stock" ? <StockCard quote={cardNode.quote} sector={cardNode.sector.key} /> : <SectorCard sector={cardNode.sector} />}
            </div>,
            // Inside the main landmark, so the card's content belongs to the page region it describes; fixed positioning
            // keeps it out of main's scrolling and clipping.
            document.getElementById("main") ?? document.body,
          )
        : null}
    </div>
  );
}
