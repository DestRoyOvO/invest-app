"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Button } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { createRule, readRule, type AlertHoldings, type AlertKind } from "@/lib/alerts";
import { formatPrice, formatShortDate, tpl } from "@/lib/format";
import type { Quote } from "@/types/api";

import { signedPercent } from "./describe";

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-warn">
      <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </p>
  );
}

interface AlertContextProps {
  symbol: string | null;
  quote: Quote | null;
  loading: boolean;
  kind: AlertKind;
  value: number | null;
  holdings: AlertHoldings;
  now: Date | null;
}

/**
 * What the rule means at today's quote, under the value field: the distance to a level, whether the condition already
 * holds (so it would trigger at once), a missing position, report date or 200-day average. Descriptive only.
 */
export function AlertContext({ symbol, quote, loading, kind, value, holdings, now }: AlertContextProps) {
  const { t, lang } = usePrefs();
  const { openPositionEditor } = useUi();
  const words = t.alerts.editor.context;
  if (!symbol) return null;
  if (!quote) return <p className="text-xs text-fg-3">{loading ? words.loading : tpl(words.noQuote, { symbol })}</p>;

  const preview = now && (kind === "cross_ma200" || value !== null) ? createRule({ symbol, kind, value, repeat: "once" }, now, null, "preview") : null;
  const reading = preview && now ? readRule(preview, quote, holdings, now) : null;
  const price = quote.price;
  const lines: ReactNode[] = [];

  if (kind === "above" || kind === "below") {
    if (value !== null && price) {
      const distance = (value / price - 1) * 100;
      lines.push(<p key="level" className="text-xs text-fg-2">{tpl(distance >= 0 ? words.levelAbove : words.levelBelow, { pct: `${Math.abs(distance).toFixed(1)}%` })}</p>);
    }
  } else if (kind === "day_move") {
    lines.push(
      <p key="today" className="text-xs text-fg-2">
        {tpl(words.today, { change: "" })}
        <Delta value={quote.changePercent} />
      </p>,
    );
  } else if (kind === "pnl_from_cost") {
    if (reading?.unavailable === "no_position") {
      lines.push(
        <div key="position" className="flex flex-wrap items-center gap-2">
          <Warn>{tpl(words.noPosition, { symbol })}</Warn>
          <Button size="sm" onClick={() => openPositionEditor(symbol)}>
            {words.addPosition}
          </Button>
        </div>,
      );
    } else if (reading?.observed !== null && reading?.observed !== undefined) {
      lines.push(<p key="pnl" className="text-xs text-fg-2">{tpl(words.pnlNow, { pnl: signedPercent(reading.observed) })}</p>);
    }
  } else if (kind === "earnings_within") {
    if (quote.nextEarningsDate && reading?.unavailable !== "no_earnings_date") {
      const date = formatShortDate(quote.nextEarningsDate, lang, "America/New_York");
      const text = quote.earningsDateEstimated ? tpl(t.alerts.event.estimatedDate, { date }) : date;
      lines.push(<p key="report" className="text-xs text-fg-2">{tpl(words.nextReport, { date: text })}</p>);
    } else {
      lines.push(<Warn key="report">{tpl(words.noReport, { symbol })}</Warn>);
    }
  } else if (kind === "cross_ma200") {
    const average = quote.twoHundredDayAverage;
    if (average && price) {
      const distance = (price / average - 1) * 100;
      lines.push(
        <p key="ma" className="text-xs text-fg-2">
          {tpl(distance >= 0 ? words.maAbove : words.maBelow, { pct: `${Math.abs(distance).toFixed(1)}%`, ma: formatPrice(average, lang) })}
        </p>,
      );
    } else {
      lines.push(<Warn key="ma">{tpl(words.noAverage, { symbol })}</Warn>);
    }
  }

  if (reading?.met && kind !== "cross_ma200") lines.push(<Warn key="met">{words.alreadyMet}</Warn>);
  return <div className="space-y-1.5">{lines}</div>;
}
