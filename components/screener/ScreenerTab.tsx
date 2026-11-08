"use client";

import { AlertTriangle, Download, Info, Link2, Loader2, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { flushSync } from "react-dom";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { useScreener } from "@/hooks/useApi";
import { useHoldings } from "@/hooks/useHoldings";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import {
  activeFilterChips,
  activePreset,
  applyPreset,
  columnsFor,
  COLUMN_SET_KEYS,
  countActiveFilters,
  csvFileName,
  daysUntil,
  EMPTY_FILTERS,
  filterRows,
  isMetricKey,
  metricUnit,
  presetsFor,
  removeFilter,
  screenToQuery,
  sectorCounts,
  sortScreenRows,
  switchUniverse,
  toCsv,
  universeSymbols,
  type ColumnSetKey,
  type FilterChip,
  type PresetKey,
  type Screen,
  type ScreenFilters,
  type SortState,
} from "@/lib/screens";
import { getSector, MAX_WATCHLIST } from "@/lib/universe";
import type { ScreenerUniverse, SectorKey } from "@/types/api";
import type { ScreenRow } from "@/types/screener";

import { PHONE_WIDTHS, screenColumns } from "./columns";
import { chipLabel } from "./display";
import { FilterRail } from "./FilterRail";
import { firstFocusable, focusFirst, revealInStrip } from "./focus";
import { SavedScreens } from "./SavedScreens";
import { useWatchToggle } from "./useWatchToggle";
import { useWidthRem } from "./useWidthRem";
import { fitColumns, tableMinWidthRem } from "./widths";

/** Clicks on these never open the row's quote; `.eqs-control` marks the checkbox and star cells. */
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role='button'],.eqs-control";

const chipClass =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-xs border px-2 text-xs whitespace-nowrap transition-colors max-sm:h-10 max-sm:px-3 focus-visible:outline-offset-1";

/** Elapsed seconds while the cold snapshot builds. The live region holds the message only, not the ticking count. */
function BuildingStatus({ count }: { count: number }) {
  const { t } = usePrefs();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex items-start gap-2 border-b border-line px-3 py-2 text-xs text-fg-2">
      <Loader2 aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin text-fg-3" strokeWidth={2} />
      <p role="status" className="min-w-0 flex-1">
        {tpl(t.screener.building, { n: count })}
      </p>
      <span aria-hidden className="num shrink-0 text-fg-3">
        {tpl(t.screener.elapsed, { s: seconds })}
      </span>
    </div>
  );
}

function Warning({ children }: { children: string }) {
  return (
    <div role="status" className="flex items-start gap-2 border-b border-line bg-panel-2 px-3 py-1.5 text-xs text-warn">
      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </div>
  );
}

interface ScreenerTabProps {
  screen: Screen;
  onScreenChange: (screen: Screen) => void;
}

/** EQS: the universe snapshot filtered, sorted and exported in the browser. */
export function ScreenerTab({ screen, onScreenChange }: ScreenerTabProps) {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const router = useRouter();
  const { data, error, mutate } = useScreener(screen.universe);
  const { watchlist, toggle, add, remove } = useWatchToggle();
  const { holdings } = useHoldings();
  const [railOpen, setRailOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // Bumped whenever the filters are replaced as a whole, so the rail also drops bounds still being typed ("-").
  const [resetToken, setResetToken] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const presetsRef = useRef<HTMLUListElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const showResultsRef = useRef<HTMLButtonElement>(null);
  const { ref: tableAreaRef, element: tableArea, widthRem: tableWidthRem } = useWidthRem<HTMLDivElement>();
  const columnTabsRef = useRef<HTMLDivElement>(null);

  // On a phone the column-set tabs scroll sideways: keep the chosen one in view (a link or a preset can pick Factors).
  useEffect(() => {
    const strip = columnTabsRef.current;
    const tab = strip?.querySelector<HTMLElement>("[role=tab][aria-selected=true]");
    if (strip && tab) revealInStrip(strip, tab);
  }, [screen.columns]);

  // SWR keeps the previous key's data while a new one loads: never show stocks under the ETF switch.
  const snapshot = data && data.universe === screen.universe ? data : undefined;
  const rows = useMemo(() => (snapshot?.rows ?? []) as ScreenRow[], [snapshot]);
  const now = snapshot ? Date.parse(snapshot.asOf) : 0;
  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);
  const holdingSet = useMemo(() => new Set(Object.keys(holdings)), [holdings]);
  const matches = useMemo(
    () => sortScreenRows(filterRows(rows, screen.filters, { watchlist: watchSet, holdings: holdingSet, now }), screen.sort),
    [rows, screen.filters, screen.sort, watchSet, holdingSet, now],
  );
  const counts = useMemo(() => sectorCounts(rows), [rows]);
  const selectedVisible = useMemo(() => matches.filter((row) => selected.has(row.symbol)).map((row) => row.symbol), [matches, selected]);

  // The set's columns that fit the table: a tablet or a laptop with the rail open drops the lower-priority ones.
  const metrics = fitColumns(columnsFor(screen), screen.universe, screen.columns, tableWidthRem);
  const universeSize = rows.length || universeSymbols(screen.universe).length;
  const activeCount = countActiveFilters(screen.filters);
  const chips = activeFilterChips(screen.filters);
  const preset = activePreset(screen);
  const kind = t.screener.kinds[screen.universe];
  const sectorLabel = (key: SectorKey) => getSector(key)?.label[lang] ?? key;
  const showFactorNote = metrics.some((key) => metricUnit(key) === "percentile");
  const sortedHidden = screen.sort && isMetricKey(screen.sort.key) && !metrics.includes(screen.sort.key) ? screen.sort.key : null;
  const estimatesShown = metrics.includes("earnings") && matches.some((row) => row.earningsDateEstimated === true && (daysUntil(row.nextEarningsDate, now) ?? -1) >= 0);
  /** Notes beside the column-set tabs: a sort by a column that is not on screen, and what "~" means in Earnings. */
  const tableNotes = [sortedHidden ? tpl(t.screener.sortedBy, { metric: t.screener.metricNames[sortedHidden] }) : null, estimatesShown ? t.screener.estimatedNote : null]
    .filter(Boolean)
    .join(" · ");

  const setFilters = (filters: ScreenFilters) => onScreenChange({ ...screen, filters });
  /** Replaces the filters as a whole (a preset, a saved screen): bounds still being typed in the rail go too. */
  const replaceScreen = (next: Screen) => {
    setResetToken((n) => n + 1);
    onScreenChange(next);
  };
  const firstPreset = () => presetsRef.current?.querySelector<HTMLElement>("button");
  // The control that was used disappears (chip row, empty state) or turns disabled (rail and sheet), so focus moves
  // to `next` once the update is on screen rather than falling back to the top of the page.
  const clearFilters = (next: () => HTMLElement | null | undefined) => {
    flushSync(() => replaceScreen({ ...screen, filters: EMPTY_FILTERS }));
    focusFirst(next());
  };
  const removeChip = (id: FilterChip["id"], index: number) => {
    flushSync(() => setFilters(removeFilter(screen.filters, id)));
    const left = chipsRef.current?.querySelectorAll<HTMLElement>("button[data-chip]");
    focusFirst(left?.[index], left?.[index - 1], firstPreset());
  };
  const togglePreset = (key: PresetKey, pressed: boolean) => replaceScreen(pressed ? { ...screen, filters: EMPTY_FILTERS } : applyPreset(screen, key));
  const setUniverse = (universe: ScreenerUniverse) => onScreenChange(switchUniverse(screen, universe));
  const setColumns = (columns: ColumnSetKey) => onScreenChange({ ...screen, columns });
  const setSort = (sort: SortState | null) => onScreenChange({ ...screen, sort });

  const toggleSelect = (symbol: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  const allSelected = matches.length > 0 && selectedVisible.length === matches.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(matches.map((row) => row.symbol)));
  /** Empties the selection; the selection bar goes away with the focused button, so focus moves to "Select all". */
  const clearSelection = () => {
    flushSync(() => setSelected(new Set()));
    focusFirst(tableArea?.querySelector<HTMLElement>("thead input[type=checkbox]"));
  };

  const addSelected = () => {
    const symbols = selectedVisible;
    const added: string[] = [];
    let present = 0;
    let full = false;
    for (const symbol of symbols) {
      const result = add(symbol);
      if (result === "added") added.push(symbol);
      else if (result === "exists") present++;
      else if (result === "full") full = true;
    }
    const message = full
      ? tpl(t.screener.selection.full, { max: MAX_WATCHLIST, n: added.length, total: symbols.length - present })
      : added.length === 0
        ? t.screener.selection.allThere
        : present > 0
          ? tpl(t.screener.selection.addedSkipped, { n: added.length, skipped: present })
          : tpl(t.screener.selection.added, { n: added.length });
    toast.show({ message, action: added.length > 0 ? { label: t.screener.undo, onAction: () => added.forEach(remove) } : undefined });
    clearSelection();
  };

  const exportCsv = () => {
    if (!snapshot) return;
    const csv = toCsv(matches, screen.universe, (key) => getSector(key)?.label.en ?? key);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFileName(screen.universe, snapshot.asOf);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyLink = async () => {
    const query = screenToQuery(screen);
    const url = `${window.location.origin}/screener${query ? `?${query}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: t.screener.actions.copied });
    } catch {
      toast.show({ message: t.screener.actions.copyFailed });
    }
  };

  // The whole row opens the quote, like DataTable's rowHref; the symbol cell holds the real link because the first
  // cell is the selection checkbox.
  const onTableClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE) || !target.closest("tbody")) return;
    const href = target.closest("tr")?.querySelector<HTMLAnchorElement>("a[data-row-link]")?.getAttribute("href");
    if (!href || window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  };

  const columns = screenColumns(metrics, {
    t,
    lang,
    universe: screen.universe,
    set: screen.columns,
    now,
    watchlist: watchSet,
    onToggleWatch: toggle,
    selected,
    onToggleSelect: toggleSelect,
    allSelected,
    someSelected,
    onToggleAll: toggleAll,
    visibleCount: matches.length,
  });

  const warnings: string[] = [];
  if (snapshot?.partial.length) {
    const list = snapshot.partial.length > 6 ? `${snapshot.partial.slice(0, 6).join(", ")} +${snapshot.partial.length - 6}` : snapshot.partial.join(", ");
    warnings.push(tpl(t.screener.warnings.partial, { list }));
  }
  if (snapshot?.warnings.includes("benchmark")) warnings.push(t.screener.warnings.benchmark);
  if (snapshot?.warnings.includes("quotes_stale")) warnings.push(t.screener.warnings.stale);

  const rail = <FilterRail screen={screen} onFiltersChange={setFilters} sectorCounts={counts} resetToken={resetToken} />;
  const openSaved = (next: Screen) => {
    replaceScreen(next);
    setSheetOpen(false);
  };

  return (
    // From lg up the tab fills the viewport and the rail and the table scroll on their own, so the results stay in view
    // while the person works down the filters. Phones keep the page flow.
    <div className={cn("grid gap-px bg-line lg:h-full lg:grid-rows-[minmax(0,1fr)]", railOpen && "lg:grid-cols-[15rem_minmax(0,1fr)]")}>
      {railOpen ? (
        <div className="hidden min-w-0 flex-col gap-px lg:flex lg:min-h-0 lg:overflow-y-auto">
          <Panel
            title={t.screener.filters.title}
            actions={
              <Button variant="ghost" size="sm" onClick={() => clearFilters(() => firstFocusable(railRef.current))} disabled={activeCount === 0}>
                {t.screener.filters.clear}
              </Button>
            }
          >
            <div ref={railRef}>{rail}</div>
          </Panel>
          <SavedScreens screen={screen} onOpen={openSaved} className="flex-1" />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-px lg:min-h-0">
        {/* The results fill their column, so a short list leaves panel, not canvas, under the table. */}
        <Panel
          title={t.screener.results}
          className="flex-1 lg:min-h-0"
          bodyClassName="flex flex-col"
          actions={
            <>
              {snapshot ? <PanelMeta>{tpl(t.screener.count, { n: matches.length, total: rows.length })}</PanelMeta> : null}
              <IconButton
                size="sm"
                label={tpl(t.screener.actions.exportHint, { n: matches.length })}
                icon={<Download className="size-3.5" strokeWidth={1.75} />}
                onClick={exportCsv}
                disabled={!snapshot || matches.length === 0}
              />
              <IconButton size="sm" label={t.screener.actions.copyHint} icon={<Link2 className="size-3.5" strokeWidth={1.75} />} onClick={copyLink} />
              <span className="hidden lg:inline-flex">
                <IconButton
                  size="sm"
                  label={railOpen ? t.screener.filters.hide : t.screener.filters.show}
                  icon={railOpen ? <PanelLeftClose className="size-3.5" strokeWidth={1.75} /> : <PanelLeftOpen className="size-3.5" strokeWidth={1.75} />}
                  onClick={() => setRailOpen((open) => !open)}
                  aria-expanded={railOpen}
                />
              </span>
              <span className="lg:hidden">
                <Button size="sm" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" className="max-sm:h-10">
                  <SlidersHorizontal aria-hidden className="size-3.5" strokeWidth={1.75} />
                  {activeCount > 0 ? tpl(t.screener.filters.buttonCount, { n: activeCount }) : t.screener.filters.button}
                </Button>
              </span>
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
            <Segmented
              label={t.screener.universe.label}
              hideLabel
              size="sm"
              value={screen.universe}
              onChange={setUniverse}
              options={[
                { value: "stocks", label: tpl(t.screener.universe.stocks, { n: universeSymbols("stocks").length }) },
                { value: "etfs", label: tpl(t.screener.universe.etfs, { n: universeSymbols("etfs").length }) },
              ]}
              className="w-full sm:w-44 [&_[role=radio]]:max-sm:h-10"
            />
            <ul ref={presetsRef} aria-label={t.screener.presets.label} className="no-scrollbar flex w-full min-w-0 gap-1.5 overflow-x-auto sm:w-auto sm:flex-1 sm:flex-wrap sm:overflow-visible">
              {presetsFor(screen.universe).map((p) => {
                const pressed = preset === p.key;
                return (
                  <li key={p.key} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={pressed}
                      title={t.screener.presetHints[p.key]}
                      onClick={() => togglePreset(p.key, pressed)}
                      className={cn(chipClass, pressed ? "border-accent/40 bg-accent-soft text-accent" : "border-line-2 text-fg-2 hover:border-fg-3 hover:text-fg")}
                    >
                      {t.screener.presets[p.key]}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {chips.length > 0 ? (
            <div ref={chipsRef} className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
              <span className="sr-only">{t.screener.filters.active}</span>
              {chips.map((chip, index) => {
                const label = chipLabel(t, chip, sectorLabel);
                return (
                  <button
                    key={chip.id}
                    type="button"
                    data-chip
                    onClick={() => removeChip(chip.id, index)}
                    aria-label={tpl(t.screener.filters.remove, { label })}
                    className={cn(chipClass, "border-line-2 text-fg hover:border-fg-3")}
                  >
                    <span className="num">{label}</span>
                    <X aria-hidden className="size-3 text-fg-3" strokeWidth={2} />
                  </button>
                );
              })}
              <Button variant="ghost" size="sm" onClick={() => clearFilters(firstPreset)} className="max-sm:h-10">
                {t.screener.filters.clear}
              </Button>
            </div>
          ) : null}

          <div className="flex items-end justify-between gap-3 border-b border-line pl-1">
            <div ref={columnTabsRef} className="no-scrollbar min-w-0 overflow-x-auto sm:shrink-0">
              <Tabs
                label={t.screener.columnSets.label}
                value={screen.columns}
                onChange={setColumns}
                options={COLUMN_SET_KEYS.map((key) => ({ value: key, label: t.screener.columnSets[key] }))}
                className="[&_[role=tab]]:max-sm:h-10"
              />
            </div>
            {tableNotes ? (
              <p className="hidden min-w-0 truncate pr-3 pb-2.5 text-micro text-fg-3 sm:block" title={tableNotes}>
                {tableNotes}
              </p>
            ) : null}
          </div>

          <StaleBanner show={Boolean(error && snapshot)} since={snapshot?.asOf} />
          {warnings.map((warning) => (
            <Warning key={warning}>{warning}</Warning>
          ))}
          {!snapshot && !error ? <BuildingStatus key={screen.universe} count={universeSymbols(screen.universe).length} /> : null}

          {showFactorNote && snapshot ? (
            <div className="flex items-start gap-2 border-b border-line px-3 py-2 text-xs text-fg-2">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} />
              <p className="min-w-0">
                <span className="font-medium text-fg">{t.screener.factorNote.title}</span>{" "}
                {tpl(t.screener.factorNote.body, { n: rows.length, kind })}{" "}
                <Link href="/lab" className="text-info underline underline-offset-2">
                  {t.screener.factorNote.link}
                </Link>
              </p>
            </div>
          ) : null}

          {selectedVisible.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2 px-3 py-1.5" role="region" aria-label={t.screener.selection.add}>
              <span className="num text-xs text-fg" aria-live="polite">
                {tpl(t.screener.selection.selected, { n: selectedVisible.length })}
              </span>
              <Button variant="primary" size="sm" onClick={addSelected} className="max-sm:h-10">
                {t.screener.selection.add}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection} className="max-sm:h-10">
                {t.screener.selection.clear}
              </Button>
            </div>
          ) : null}

          {error && !snapshot ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : (
            // Row clicks bubble here; keyboard users have the symbol link in each row.
            <div
              ref={tableAreaRef}
              onClick={onTableClick}
              style={{ "--eqs-wide": `${tableMinWidthRem(metrics)}rem` } as CSSProperties}
              className="relative [--eqs-max-h:max(22rem,calc(100dvh-19rem))] lg:min-h-64 lg:flex-1 lg:[--eqs-max-h:none]"
            >
              <DataTable
                rows={matches}
                columns={columns}
                rowKey={(row) => row.symbol}
                caption={tpl(t.screener.caption, { n: matches.length, kind })}
                sort={screen.sort}
                onSortChange={setSort}
                rowClassName={(row) => cn("cursor-pointer", selected.has(row.symbol) && "bg-panel-2")}
                loading={!snapshot}
                loadingRows={10}
                stickyHeader
                maxHeight="var(--eqs-max-h)"
                minWidth="var(--eqs-min)"
                className={cn("[--eqs-min:0px] sm:[--eqs-min:var(--eqs-wide)] lg:absolute lg:inset-0", PHONE_WIDTHS)}
                empty={
                  <EmptyState
                    actions={
                      activeCount > 0 ? (
                        <Button size="sm" onClick={() => clearFilters(firstPreset)} className="max-sm:h-10">
                          {t.screener.filters.clear}
                        </Button>
                      ) : undefined
                    }
                  >
                    {tpl(t.screener.empty.noMatch, { kind: t.screener.kindNouns[screen.universe] })} {activeCount > 0 ? t.screener.empty.hint : null}
                  </EmptyState>
                }
              />
            </div>
          )}
        </Panel>
      </div>

      <Drawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t.screener.filters.title}
        side="auto"
        footer={
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <Button variant="ghost" onClick={() => clearFilters(() => showResultsRef.current)} disabled={activeCount === 0} className="max-sm:h-10">
              {t.screener.filters.clear}
            </Button>
            <Button ref={showResultsRef} variant="primary" onClick={() => setSheetOpen(false)} className="max-sm:h-10">
              {tpl(t.screener.filters.showResults, { n: snapshot ? matches.length : universeSize })}
            </Button>
          </div>
        }
      >
        {rail}
        <div className="border-t border-line">
          <SavedScreens screen={screen} onOpen={openSaved} bare />
        </div>
      </Drawer>
    </div>
  );
}
