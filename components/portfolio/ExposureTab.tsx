"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";
import { formatNumber, formatRatio, tpl } from "@/lib/format";
import type { Portfolio } from "@/lib/portfolio";
import { assetClassExposure, currencyExposure, sectorExposure, type GroupInfo } from "@/lib/portfolio-analytics";
import type { Quote } from "@/types/api";

import { assetClassLabel, holdingGroupLabel } from "./labels";

interface BarRow {
  id: string;
  label: string;
  /** 0..1 share of the total; null when it cannot be expressed (an unconverted currency). */
  weight: number | null;
  value: string;
  note?: string;
  symbols: string[];
}

/** Neutral exposure bars: a --fg-3 fill on a --line-2 track (exposure is not a gain or a loss), label line above. */
function Bars({ title, rows, className }: { title: string; rows: BarRow[]; className?: string }) {
  return (
    <section className={cn("min-w-0 bg-panel px-3 py-3", className)}>
      <h3 className="col-head">{title}</h3>
      <ul aria-label={title} className="mt-2 space-y-2.5">
        {rows.map((row) => (
          <li key={row.id} title={row.symbols.join(", ")} className="text-data">
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-fg-2">
                {row.label}
                {row.note ? <span className="ml-1.5 text-micro text-fg-3">{row.note}</span> : null}
              </span>
              <span className="num shrink-0 text-fg-3">{row.value}</span>
              <span className="num w-14 shrink-0 text-right text-fg">{row.weight === null ? "—" : formatRatio(row.weight, { digits: 1 })}</span>
            </div>
            <span aria-hidden className="relative mt-1 block h-1.5 w-full bg-line-2">
              {row.weight !== null ? <span className="absolute inset-y-0 left-0 bg-fg-3" style={{ width: `${Math.max(0, Math.min(1, row.weight)) * 100}%` }} /> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ExposureTabProps {
  portfolio: Portfolio;
  quotes: ReadonlyMap<string, Quote>;
  infoOf: (symbol: string) => GroupInfo;
  /** Latest FX quotes by Yahoo symbol (e.g. "JPYUSD=X"), for the currency breakdown. */
  fx: ReadonlyMap<string, Quote>;
}

/** Sector, asset-class and currency exposure by value. */
export function ExposureTab({ portfolio, quotes, infoOf, fx }: ExposureTabProps) {
  const { t, lang } = usePrefs();
  const e = t.port.exposure;
  const money = (v: number) => formatNumber(v, 0, lang);
  const sectors = sectorExposure(portfolio.rows, infoOf).map<BarRow>((s) => ({ id: s.id, label: holdingGroupLabel(s.key, t, lang), weight: s.weight, value: money(s.value), symbols: s.symbols }));
  const classes = assetClassExposure(portfolio.rows, (s) => quotes.get(s)?.quoteType ?? null).map<BarRow>((s) => ({
    id: s.id,
    label: assetClassLabel(s.key, t),
    weight: s.weight,
    value: money(s.value),
    symbols: s.symbols,
  }));
  const currencies = currencyExposure([...portfolio.rows, ...portfolio.foreign], portfolio.baseCurrency, (pair) => fx.get(pair)?.price ?? null);
  const currencyRows = currencies.slices.map<BarRow>((s) => ({
    id: s.currency,
    label: s.currency,
    weight: s.weight,
    value: s.value === null ? money(s.localValue) : money(s.value),
    note: s.value === null ? e.notConverted : s.currency !== currencies.base ? `(${money(s.localValue)} ${s.currency})` : undefined,
    symbols: s.symbols,
  }));
  const hasForeign = portfolio.foreign.length > 0;

  return (
    <div>
      <div className="grid gap-px bg-line md:grid-cols-2">
        <Bars title={e.sector} rows={sectors} />
        <div className="flex min-w-0 flex-col gap-px">
          <Bars title={e.assetClass} rows={classes} />
          <Bars title={e.currency} rows={currencyRows} className="flex-1" />
        </div>
      </div>
      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        <p>{tpl(e.note, { currency: portfolio.baseCurrency })}</p>
        {hasForeign ? <p>{e.currencyNote}</p> : null}
      </div>
    </div>
  );
}

