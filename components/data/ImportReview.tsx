"use client";

import { AlertCircle, Check, HelpCircle, Loader, MinusCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { HOLDINGS_STORAGE_KEY, sanitizeHoldings, useHoldings, type Holdings } from "@/hooks/useHoldings";
import { applyWrites, diffHoldings, mergeHoldings, StorageWriteError, undoChanges, type RestoreMode, type StorageChange } from "@/lib/backup";
import { combinePositions, type ImportRow, type RowError, type SkipReason } from "@/lib/broker-import";
import { cn } from "@/lib/cn";
import { DASH, formatPrice, tpl } from "@/lib/format";

import { getEnv } from "./browser";
import { useSymbolChecks } from "./hooks";
import { formatShares, symbolList } from "./labels";
import { focusSoon, TOUCH } from "./styles";

export interface ImportOutcome {
  changes: StorageChange[];
  /** Positions in the import. */
  count: number;
}

type RowStatus =
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "error"; error: RowError }
  | { kind: "checking" }
  | { kind: "ready"; name: string | null }
  | { kind: "unknown"; suggestions: string[] }
  | { kind: "unchecked" };

interface Entry {
  row: ImportRow;
  /** The symbol to save: a chosen suggestion or the row's own. */
  symbol: string | null;
  status: RowStatus;
}

// Suggestion chips: the empty-state chip look, accent on hover.
const CHIP =
  "mono inline-flex h-7 items-center rounded-xs border border-line-2 px-2 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent max-sm:h-10 max-sm:px-3";

/** The result of an import with its toast and Undo, for the panel that runs it. */
export function useImportOutcome() {
  const { t } = usePrefs();
  const toast = useToast();
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const undo = useCallback(
    (changes: readonly StorageChange[]) => {
      const env = getEnv();
      if (env) undoChanges(env, changes);
      setOutcome(null);
      toast.show({ message: t.data.review.undone });
    },
    [t, toast],
  );

  const record = useCallback(
    (next: ImportOutcome) => {
      setOutcome(next);
      toast.show({ message: tpl(t.data.review.done, { n: next.count }), action: { label: t.data.undo, onAction: () => undo(next.changes) } });
    },
    [t, toast, undo],
  );

  return { outcome, record, undo, clear: useCallback(() => setOutcome(null), []) };
}

/** The line shown after an import: what happened, a way to see it, and Undo. */
export function ImportDone({ outcome, onUndo }: { outcome: ImportOutcome; onUndo: () => void }) {
  const { t } = usePrefs();
  return (
    // Focus moves here from the import button, which is gone once the import is done.
    <div role="status" tabIndex={-1} autoFocus className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3 py-2.5 text-sm text-fg-2 focus:outline-none">
      <Check aria-hidden className="size-4 shrink-0 text-fg-3" strokeWidth={2} />
      <span>{tpl(t.data.review.done, { n: outcome.count })}</span>
      <Link href="/watchlist" className="text-info underline-offset-2 hover:underline">
        {t.data.review.view}
      </Link>
      <Button size="sm" variant="ghost" onClick={onUndo} className={TOUCH}>
        {t.data.undo}
      </Button>
    </div>
  );
}

function statusOf(row: ImportRow, symbol: string | null, check: ReturnType<typeof useSymbolChecks>["checks"]): RowStatus {
  if (row.skip) return { kind: "skipped", reason: row.skip };
  if (row.error || !symbol) return { kind: "error", error: row.error ?? "symbol" };
  const result = check.get(symbol);
  if (!result) return { kind: "checking" };
  if (result.status === "found") return { kind: "ready", name: result.info.name };
  if (result.status === "missing") return { kind: "unknown", suggestions: result.suggestions };
  return { kind: "unchecked" };
}

function choiceKey(row: ImportRow): string {
  return `${row.line}:${row.rawSymbol}`;
}

function readHoldings(raw: string | null): Holdings {
  if (!raw) return {};
  try {
    return sanitizeHoldings(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Preview and import of parsed positions: each row's symbol is checked against a live quote (suggestions for unknown
 * ones), skipped rows and errors are listed with their reasons, and Merge or Replace says exactly what changes before
 * the positions are saved in one atomic write.
 */
export function ImportReview({ rows, onImported }: { rows: readonly ImportRow[]; onImported: (outcome: ImportOutcome) => void }) {
  const { t, lang } = usePrefs();
  const { holdings } = useHoldings();
  // Suggestions picked per row, keyed by line and the text written there, so an edit above does not move a choice.
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLButtonElement>(null);

  const symbols = useMemo(() => {
    const out = new Set<string>();
    for (const row of rows) {
      const symbol = chosen.get(choiceKey(row)) ?? row.symbol;
      if (!row.skip && !row.error && symbol) out.add(symbol);
    }
    return [...out];
  }, [rows, chosen]);

  const queriesOf = useCallback(
    (symbol: string) => {
      const row = rows.find((candidate) => candidate.symbol === symbol);
      return row ? [row.rawSymbol, row.name ?? ""].filter(Boolean) : [symbol];
    },
    [rows],
  );
  const { checks, retry } = useSymbolChecks(symbols, queriesOf);

  const entries: Entry[] = useMemo(
    () =>
      rows.map((row) => {
        const symbol = chosen.get(choiceKey(row)) ?? row.symbol;
        return { row, symbol, status: statusOf(row, symbol, checks) };
      }),
    [rows, chosen, checks],
  );

  const importable = useMemo(() => entries.filter((entry) => entry.status.kind === "ready" || entry.status.kind === "unchecked"), [entries]);
  const { holdings: incoming, combined } = useMemo(
    () => combinePositions(importable.map((entry) => ({ symbol: entry.symbol as string, shares: entry.row.shares as number, cost: entry.row.cost as number }))),
    [importable],
  );
  const count = Object.keys(incoming).length;
  const checking = entries.some((entry) => entry.status.kind === "checking");
  const failed = entries.some((entry) => entry.status.kind === "unchecked");
  const notImported = entries.filter((entry) => entry.status.kind === "unknown" || entry.status.kind === "error" || entry.status.kind === "skipped");
  const skipped = entries.filter((entry) => entry.status.kind === "skipped").length;
  const problems = entries.filter((entry) => entry.status.kind === "error" || entry.status.kind === "unknown").length;
  const preview = diffHoldings(holdings, mergeHoldings(holdings, incoming, mode));

  const choose = (row: ImportRow, symbol: string) => {
    setChosen((current) => new Map(current).set(choiceKey(row), symbol));
  };

  const commit = () => {
    setConfirming(false);
    setError(null);
    const env = getEnv();
    if (!env) {
      setError(t.data.backup.errors.unavailable);
      return;
    }
    // Merge against what is stored right now, so an edit in another tab is not lost.
    const next = mergeHoldings(readHoldings(env.storage.getItem(HOLDINGS_STORAGE_KEY)), incoming, mode);
    try {
      const changes = applyWrites(env, { [HOLDINGS_STORAGE_KEY]: JSON.stringify(next) });
      onImported({ changes, count });
    } catch (cause) {
      setError(cause instanceof StorageWriteError ? t.data.backup.errors[cause.reason] : t.data.backup.errors.unavailable);
    }
  };

  const onImport = () => {
    if (mode === "replace" && preview.removed.length > 0) setConfirming(true);
    else commit();
  };

  const columns: DataTableColumn<Entry>[] = [
    { key: "line", header: t.data.review.columns.line, width: "3.25rem", hideBelow: "sm", render: (entry) => <span className="num text-fg-3">{entry.row.line}</span> },
    {
      key: "symbol",
      header: t.data.review.columns.symbol,
      width: "11rem",
      render: (entry) => (
        <span title={entry.row.fix ? tpl(t.data.review.fixed, { raw: entry.row.rawSymbol }) : undefined}>
          {/* Phones have no status column: an icon (with its words for screen readers) leads the row instead. */}
          <StatusIcon status={entry.status} className="mr-1.5 sm:hidden" />
          {entry.symbol ? (
            <>
              <span className="mono font-medium text-fg">{entry.symbol}</span>
              {entry.row.fix && !chosen.has(choiceKey(entry.row)) ? <span className="ml-1.5 text-micro text-fg-3">{tpl(t.data.review.fixed, { raw: entry.row.rawSymbol })}</span> : null}
            </>
          ) : (
            <span className="mono text-fg-3">{entry.row.rawSymbol || DASH}</span>
          )}
        </span>
      ),
    },
    {
      key: "name",
      header: t.data.review.columns.name,
      hideBelow: "md",
      render: (entry) => {
        const name = entry.status.kind === "ready" ? entry.status.name : entry.row.name;
        return (
          <span className="text-fg-2" title={name ?? undefined}>
            {name ?? DASH}
          </span>
        );
      },
    },
    {
      key: "shares",
      header: t.data.review.columns.shares,
      align: "right",
      width: "5.5rem",
      render: (entry) => <span className="num text-fg">{entry.row.shares === null ? DASH : formatShares(entry.row.shares, lang)}</span>,
    },
    { key: "cost", header: t.data.review.columns.cost, align: "right", width: "6rem", render: (entry) => <span className="num text-fg">{formatPrice(entry.row.cost, lang)}</span> },
    { key: "status", header: t.data.review.columns.status, width: "11.5rem", hideBelow: "sm", render: (entry) => <StatusText status={entry.status} /> },
  ];

  const summary =
    mode === "merge"
      ? tpl(t.data.review.mergeSummary, { added: preview.added.length, updated: preview.updated.length })
      : tpl(t.data.review.replaceSummary, { added: preview.added.length, updated: preview.updated.length, removed: preview.removed.length });

  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-xs">
        <span className="num text-fg-2">{tpl(t.data.review.counts, { ready: importable.length, skipped, problems })}</span>
        {failed ? (
          <span className="flex flex-wrap items-center gap-2 text-warn">
            {t.data.review.checkFailed}
            <Button size="sm" onClick={retry} className={TOUCH}>
              {t.data.review.retry}
            </Button>
          </span>
        ) : null}
      </div>
      <DataTable
        rows={entries}
        columns={columns}
        rowKey={(entry) => String(entry.row.line)}
        caption={t.data.review.caption}
        // Rows are not links, so they do not highlight; the status colors then always sit on the panel color.
        rowClassName={() => "hover:bg-panel!"}
        stickyHeader
        maxHeight="min(55vh, 440px)"
      />
      {notImported.length > 0 ? (
        <ul
          aria-label={t.data.review.notImported}
          className={cn("space-y-1.5 border-t border-line px-3 py-2.5", !notImported.some((entry) => entry.status.kind === "unknown") && "sm:hidden")}
        >
          {notImported.map((entry) => (
            // Unknown symbols are always listed for their suggestions; errors and skipped rows only on phones, where
            // the table has no status column.
            <li key={entry.row.line} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs", entry.status.kind !== "unknown" && "sm:hidden")}>
              <span className="text-fg-3">{tpl(t.data.review.line, { line: entry.row.line })}</span>
              <span className="mono text-fg">{entry.symbol ?? (entry.row.rawSymbol || DASH)}</span>
              <StatusText status={entry.status} />
              {entry.status.kind === "unknown" ? (
                entry.status.suggestions.length > 0 ? (
                  <>
                    <span className="text-fg-3">{t.data.review.didYouMean}</span>
                    <span role="group" aria-label={tpl(t.data.review.suggestions, { symbol: entry.symbol ?? "" })} className="flex flex-wrap items-center gap-1.5">
                      {entry.status.suggestions.map((symbol) => (
                        <button key={symbol} type="button" className={CHIP} aria-label={tpl(t.data.review.use, { symbol })} onClick={() => choose(entry.row, symbol)}>
                          {symbol}
                        </button>
                      ))}
                    </span>
                  </>
                ) : (
                  <span className="text-fg-3">{t.data.review.noSuggestions}</span>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-3 border-t border-line px-3 py-3">
        {combined.length > 0 ? <p className="text-xs text-fg-3">{tpl(t.data.review.combined, { symbols: symbolList(combined) })}</p> : null}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <Segmented
            size="sm"
            label={t.data.review.mode}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setConfirming(false);
            }}
            options={[
              { value: "merge", label: t.data.review.merge },
              { value: "replace", label: t.data.review.replace },
            ]}
            className="w-44"
          />
          <p className="min-w-48 flex-1 pb-1 text-xs text-fg-2">{summary}</p>
        </div>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="w-full text-sm text-fg">{tpl(t.data.review.confirmReplace, { symbols: symbolList(preview.removed) })}</p>
            <Button onClick={commit} className={TOUCH} autoFocus>
              {t.data.review.replaceNow}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
                focusSoon(importRef);
              }}
              className={TOUCH}
            >
              {t.data.cancel}
            </Button>
          </div>
        ) : (
          <Button ref={importRef} onClick={onImport} disabled={count === 0 || checking} className={TOUCH}>
            {checking ? t.data.review.status.checking : count === 1 ? t.data.review.importOne : tpl(t.data.review.importMany, { n: count })}
          </Button>
        )}
        {error ? (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The row status as a glyph, for phones; the words stay available to screen readers. */
function StatusIcon({ status, className }: { status: RowStatus; className?: string }) {
  const { t } = usePrefs();
  const words =
    status.kind === "skipped"
      ? tpl(t.data.review.status.skipped, { reason: t.data.review.skip[status.reason] })
      : status.kind === "error"
        ? t.data.review.errors[status.error]
        : t.data.review.status[status.kind];
  const Icon = status.kind === "ready" ? Check : status.kind === "unknown" || status.kind === "error" ? AlertCircle : status.kind === "skipped" ? MinusCircle : status.kind === "unchecked" ? HelpCircle : Loader;
  const spin = status.kind === "checking" ? "animate-spin" : undefined;
  const tone = status.kind === "unknown" || status.kind === "error" ? "text-danger" : status.kind === "unchecked" ? "text-warn" : "text-fg-3";
  return (
    <span className={cn("inline-flex align-[-2px]", tone, className)}>
      <Icon aria-hidden className={cn("size-3.5", spin)} strokeWidth={2} />
      <span className="sr-only">{words}</span>
    </span>
  );
}

function StatusText({ status }: { status: RowStatus }) {
  const { t } = usePrefs();
  switch (status.kind) {
    case "ready":
      return <span className="text-fg-2">{t.data.review.status.ready}</span>;
    case "checking":
      return <span className="text-fg-3">{t.data.review.status.checking}</span>;
    case "unchecked":
      return <span className="text-warn">{t.data.review.status.unchecked}</span>;
    case "skipped":
      return <span className="text-fg-3">{tpl(t.data.review.status.skipped, { reason: t.data.review.skip[status.reason] })}</span>;
    case "unknown":
      return (
        <span className="inline-flex items-center gap-1 text-danger">
          <AlertCircle aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
          {t.data.review.status.unknown}
        </span>
      );
    case "error":
      return (
        <span className="inline-flex min-w-0 items-center gap-1 text-danger" title={t.data.review.errors[status.error]}>
          <AlertCircle aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{t.data.review.errors[status.error]}</span>
        </span>
      );
  }
}
