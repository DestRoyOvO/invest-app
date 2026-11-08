"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import type { MarketState } from "@/types/api";

import { useNow } from "./clock";
import { etClock, ET_TIME_ZONE, formatDuration, sessionCountdown } from "./session";

export function marketStateTone(state: MarketState | null | undefined): "open" | "extended" | "closed" | "unknown" {
  if (state === "REGULAR") return "open";
  if (state === "PRE" || state === "POST" || state === "PREPRE" || state === "POSTPOST") return "extended";
  if (state === "CLOSED") return "closed";
  return "unknown";
}

/**
 * Market state as a 6px dot: filled accent while the regular session trades, an accent ring in pre-market and after
 * hours, gray when closed. Never the up or down color: a session state is not a price move. Pair it with the state text.
 */
export function StateDot({ state, className }: { state: MarketState | null | undefined; className?: string }) {
  const tone = marketStateTone(state);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "open" ? "bg-accent" : tone === "extended" ? "border border-accent" : tone === "closed" ? "bg-fg-3" : "bg-line-2",
        className,
      )}
    />
  );
}

const ET_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: ET_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** "Opens in 4h 31m" / "Closes in 1h 12m" (or the short form), or null before the clock runs. */
export function countdownText(t: Messages, state: MarketState | null | undefined, now: number | null, short = false): string | null {
  if (now === null) return null;
  const countdown = sessionCountdown(state ?? null, etClock(now));
  const time = formatDuration(countdown.minutes, t.shell.duration);
  const templates = t.shell.countdown;
  if (countdown.kind === "closes") return tpl(short ? templates.closesShort : templates.closes, { time });
  return tpl(short ? templates.opensShort : templates.opens, { time });
}

/**
 * Market state, an approximate countdown to the next open or close, and the New York time (ET), ticking every second.
 * The compact variant (phones and tablets) shows the dot and the short countdown; below 390px only the dot, so the
 * phone command field keeps room for its word even with the widest countdown ("距开盘 23小时59分"). Screen readers get
 * the state and the countdown either way. Time-dependent text renders only after hydration.
 */
export function MarketClock({ state, compact = false }: { state: MarketState | null | undefined; compact?: boolean }) {
  const { t } = usePrefs();
  const now = useNow("second");
  const label = state ? t.shell.marketState[state] : t.shell.marketState.unknown;
  const countdown = countdownText(t, state, now);
  const note = countdown ? `${label} · ${countdown}. ${t.shell.countdown.note}` : label;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-xs" title={note}>
        <StateDot state={state} />
        <span className="sr-only">{countdown ? `${label}. ${countdown}` : label}</span>
        <span aria-hidden className="num whitespace-nowrap text-fg-2 max-[390px]:hidden">
          {countdownText(t, state, now, true) ?? label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs whitespace-nowrap" title={note}>
      <StateDot state={state} />
      <span className="text-fg-2">{label}</span>
      {countdown ? <span className="num text-fg-3">{countdown}</span> : null}
      <span className="num text-fg-2">{tpl(t.shell.et, { time: now === null ? "--:--:--" : ET_CLOCK.format(now) })}</span>
    </div>
  );
}
