"use client";

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { tpl } from "@/lib/format";
import {
  appliesTo,
  EARNINGS_WINDOWS,
  LIST_FILTERS,
  RANGE_KEYS,
  setRange,
  type ListFilter,
  type MetricKey,
  type Screen,
  type ScreenFilters,
  type Trend,
} from "@/lib/screens";
import { SECTORS } from "@/lib/universe";
import type { SectorKey } from "@/types/api";

import { RangeField } from "./RangeField";

type RangeGroupKey = "size" | "performance" | "risk" | "analysts" | "factors";

const RANGE_GROUPS: ReadonlyArray<{ key: RangeGroupKey; metrics: readonly MetricKey[] }> = [
  { key: "size", metrics: ["cap", "assets", "price", "pe", "fpe", "pb", "yield", "er"] },
  { key: "performance", metrics: ["chg", "ytd", "r1m", "r3m", "r6m", "high", "rsi"] },
  { key: "risk", metrics: ["vol", "beta", "dvol"] },
  { key: "analysts", metrics: ["rating"] },
  { key: "factors", metrics: ["momPct", "revPct", "highPct", "volPct", "betaPct"] },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 px-3 py-3">
      <h3 className="col-head">{title}</h3>
      {children}
    </section>
  );
}

interface RangeGroupProps {
  title: string;
  metrics: readonly MetricKey[];
  filters: ScreenFilters;
  onFiltersChange: (filters: ScreenFilters) => void;
  resetToken: number;
}

/**
 * A collapsible group of min/max fields. It opens when one of its ranges gets a value (a preset, a link) and otherwise
 * keeps the state the person chose, so clearing the last field never folds the group away under the cursor.
 */
function RangeGroup({ title, metrics, filters, onFiltersChange, resetToken }: RangeGroupProps) {
  const { t } = usePrefs();
  const set = metrics.filter((key) => filters.ranges[key]).length;
  const [open, setOpen] = useState(set > 0);
  const [seen, setSeen] = useState(set);
  if (set !== seen) {
    setSeen(set);
    if (set > seen) setOpen(true);
  }
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group/range">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 transition-colors select-none hover:bg-hover [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-3 transition-transform group-open/range:rotate-90" strokeWidth={2} />
        <span className="col-head flex-1">{title}</span>
        {set > 0 ? <span className="num text-micro text-fg-2">{tpl(t.screener.filters.groupCount, { n: set })}</span> : null}
      </summary>
      <div className="space-y-3 px-3 pt-1 pb-3">
        {metrics.map((key) => (
          <RangeField
            key={key}
            metric={key}
            range={filters.ranges[key]}
            onChange={(range) => onFiltersChange(setRange(filters, key, range))}
            resetToken={resetToken}
          />
        ))}
      </div>
    </details>
  );
}

interface FilterRailProps {
  screen: Screen;
  onFiltersChange: (filters: ScreenFilters) => void;
  /** Rows per sector in the snapshot, shown beside the sector names. */
  sectorCounts: Partial<Record<SectorKey, number>>;
  /** Changes when the filters are replaced as a whole (Clear all, a preset): unfinished bounds are dropped too. */
  resetToken: number;
}

/** The screener's filter controls: sectors, trend, events, my lists and min/max ranges in collapsible groups. */
export function FilterRail({ screen, onFiltersChange, sectorCounts, resetToken }: FilterRailProps) {
  const { t, lang } = usePrefs();
  const { filters, universe } = screen;
  const update = (patch: Partial<ScreenFilters>) => onFiltersChange({ ...filters, ...patch });

  const toggleSector = (key: SectorKey) =>
    update({ sectors: filters.sectors.includes(key) ? filters.sectors.filter((s) => s !== key) : [...filters.sectors, key] });

  const trendOptions = [
    { value: "any", label: t.screener.filters.any },
    { value: "above", label: t.screener.filters.above },
    { value: "below", label: t.screener.filters.below },
  ] as const;
  const toTrend = (value: string): Trend | null => (value === "above" || value === "below" ? value : null);

  const earningsOptions: number[] = [...EARNINGS_WINDOWS];
  if (filters.earningsWithinDays !== null && !earningsOptions.includes(filters.earningsWithinDays)) earningsOptions.push(filters.earningsWithinDays);
  earningsOptions.sort((a, b) => a - b);

  return (
    <div className="divide-y divide-line">
      {universe === "stocks" ? (
        <Section title={t.screener.filters.sector}>
          <ul className="space-y-1.5">
            {SECTORS.map((sector) => (
              <li key={sector.key} className="flex items-center justify-between gap-2">
                <Checkbox
                  checked={filters.sectors.includes(sector.key)}
                  onChange={() => toggleSector(sector.key)}
                  label={sector.label[lang]}
                  className="min-w-0 max-sm:min-h-10 max-sm:items-center"
                />
                <span className="num shrink-0 text-xs text-fg-3">{sectorCounts[sector.key] ?? ""}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={t.screener.filters.trend}>
        <Segmented
          label={t.screener.filters.ma50}
          size="sm"
          value={filters.ma50 ?? "any"}
          options={trendOptions}
          onChange={(value) => update({ ma50: toTrend(value) })}
        />
        <Segmented
          label={t.screener.filters.ma200}
          size="sm"
          value={filters.ma200 ?? "any"}
          options={trendOptions}
          onChange={(value) => update({ ma200: toTrend(value) })}
        />
      </Section>

      {universe === "stocks" ? (
        <Section title={t.screener.filters.events}>
          <Field label={t.screener.filters.earnings}>
            <Select
              className="w-full"
              size="sm"
              value={filters.earningsWithinDays === null ? "" : String(filters.earningsWithinDays)}
              onChange={(event) => update({ earningsWithinDays: event.target.value === "" ? null : Number(event.target.value) })}
            >
              <option value="">{t.screener.filters.earningsAny}</option>
              {earningsOptions.map((days) => (
                <option key={days} value={days}>
                  {tpl(t.screener.filters.earningsDays, { n: days })}
                </option>
              ))}
            </Select>
          </Field>
        </Section>
      ) : null}

      <Section title={t.screener.filters.lists}>
        <Field label={t.screener.filters.list}>
          <Select
            className="w-full"
            size="sm"
            value={filters.list ?? ""}
            onChange={(event) => update({ list: event.target.value === "" ? null : (event.target.value as ListFilter) })}
          >
            <option value="">{t.screener.filters.listAny}</option>
            {LIST_FILTERS.map((list) => (
              <option key={list} value={list}>
                {t.screener.filters.listOptions[list]}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {RANGE_GROUPS.map((group) => {
        const metrics = group.metrics.filter((key) => RANGE_KEYS.includes(key) && appliesTo(key, universe));
        if (metrics.length === 0) return null;
        return (
          <RangeGroup
            key={`${universe}-${group.key}`}
            title={t.screener.filters.groups[group.key]}
            metrics={metrics}
            filters={filters}
            onFiltersChange={onFiltersChange}
            resetToken={resetToken}
          />
        );
      })}
    </div>
  );
}
