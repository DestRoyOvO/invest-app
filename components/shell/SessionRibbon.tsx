"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { tpl } from "@/lib/format";
import type { MarketState } from "@/types/api";

import { useNow } from "./clock";
import { etClock, ET_TIME_ZONE, minutesToOpen, ribbonModel, type SegmentKind } from "./session";

// Accent mixes over the panel: pre-market and after hours at 25%, the regular session at 60%, the elapsed part of each
// brighter. Decorative (the market clock carries the same information as text), so it is hidden from screen readers.
//
// Each segment has a hover strip reaching 6px up into the top bar, so its title is easy to find with a mouse. Below sm
// the top bar buttons are 40px tall and end 2px above the ribbon, so the strip would take taps meant for them: there it
// ignores the pointer (touch has no hover anyway).
const HOVER_STRIP = "absolute inset-x-0 -top-1.5 bottom-0 z-10 max-sm:pointer-events-none";
const REMAINING: Record<SegmentKind, string> = {
  pre: "color-mix(in oklab, var(--accent) 25%, var(--panel))",
  regular: "color-mix(in oklab, var(--accent) 60%, var(--panel))",
  post: "color-mix(in oklab, var(--accent) 25%, var(--panel))",
};
const ELAPSED: Record<SegmentKind, string> = {
  pre: "color-mix(in oklab, var(--accent) 50%, var(--panel))",
  regular: "var(--accent)",
  post: "color-mix(in oklab, var(--accent) 50%, var(--panel))",
};

/**
 * The 2px session ribbon under the top bar: 04:00 to 20:00 ET, with pre-market, regular and after-hours segments, the
 * elapsed part brighter and a 1px tick at now (updated every 30 seconds). Open or closed comes from Yahoo's
 * marketState; on closed days the ribbon is a plain rule titled with the next open. Hovering a segment shows its hours.
 */
export function SessionRibbon({ state }: { state: MarketState | null | undefined }) {
  const { t, lang } = usePrefs();
  const now = useNow("halfMinute");
  if (now === null) return <div aria-hidden className="h-0.5 shrink-0 bg-line" />;

  const clock = etClock(now);
  const model = ribbonModel(state ?? null, clock);

  if (!model.open) {
    const opensAt = now + minutesToOpen(state ?? null, clock) * 60_000;
    const day = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { timeZone: ET_TIME_ZONE, weekday: "short" }).format(opensAt);
    const when = `${day} ${tpl(t.shell.et, { time: "09:30" })}`;
    return (
      <div aria-hidden className="relative h-0.5 shrink-0 bg-line-2" data-testid="session-ribbon" data-state="closed">
        <div className={HOVER_STRIP} title={tpl(t.shell.session.closed, { when })} />
      </div>
    );
  }

  return (
    <div aria-hidden className="relative flex h-0.5 shrink-0 bg-panel" data-testid="session-ribbon" data-state="open">
      {model.segments.map((segment) => (
        <div key={segment.kind} className="relative h-full" style={{ width: `${segment.width * 100}%`, background: REMAINING[segment.kind] }}>
          <div className="absolute inset-y-0 left-0" style={{ width: `${segment.elapsed * 100}%`, background: ELAPSED[segment.kind] }} />
          <div className={HOVER_STRIP} title={t.shell.session[segment.kind]} />
        </div>
      ))}
      {model.now !== null ? <div className="absolute inset-y-0 z-[5] w-px bg-fg" style={{ left: `calc(${model.now * 100}% - 0.5px)` }} /> : null}
    </div>
  );
}
