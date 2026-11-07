"use client";

import { useEffect, useState } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";
import type { MarketState } from "@/types/api";

export function marketStateTone(state: MarketState | null | undefined): "open" | "extended" | "closed" | "unknown" {
  if (state === "REGULAR") return "open";
  if (state === "PRE" || state === "POST" || state === "PREPRE" || state === "POSTPOST") return "extended";
  if (state === "CLOSED") return "closed";
  return "unknown";
}

export function StateDot({ state, className }: { state: MarketState | null | undefined; className?: string }) {
  const tone = marketStateTone(state);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "open" ? "bg-up" : tone === "extended" ? "bg-warn" : "bg-fg-3",
        className,
      )}
    />
  );
}

const NY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** New York time, ticking every second. Renders a placeholder on the server to avoid hydration mismatches. */
export function MarketClock({ state }: { state: MarketState | null | undefined }) {
  const t = useT();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const label = state ? t.shell.marketState[state] : t.shell.marketState.unknown;
  return (
    <div className="flex items-center gap-2 text-xs" title={label}>
      <StateDot state={state} />
      <span className="text-fg-2">{label}</span>
      <span className="num text-fg-3">
        {t.shell.newYork} <span className="text-fg-2">{now ? NY_FORMAT.format(now) : "--:--:--"}</span>
      </span>
    </div>
  );
}
