"use client";

import { Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { useToast } from "@/components/ui/Toast";
import { requestNotificationPermission, setAlertEditTarget, useAlertLog, useAlertRules, useNotificationPermission, useQuoteMap } from "@/hooks/useAlerts";
import { useHoldings } from "@/hooks/useHoldings";
import { useHydrated } from "@/hooks/useLocalValue";
import { useNow } from "@/hooks/useNotes";
import { useWatchlist } from "@/hooks/useWatchlist";
import {
  baselineFromQuote,
  clearAlertLog,
  markAlertEventsSeen,
  MAX_ALERT_RULES,
  readRule,
  rearmAlertRule,
  removeAlertRule,
  restoreAlertLog,
  restoreAlertRule,
  ruleStatus,
  setAlertPaused,
  unseenCount,
  type AlertEvent,
  type AlertReading,
  type AlertRule,
  type RuleStatus,
} from "@/lib/alerts";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDate, formatPrice, formatRelativeTime, formatTime, tpl } from "@/lib/format";
import type { Quote } from "@/types/api";

import { describeAlertEvent, describeReading, describeRule } from "./describe";

interface RuleRow {
  rule: AlertRule;
  quote: Quote | undefined;
  status: RuleStatus;
  reading: AlertReading | null;
}

const STATUS_ORDER: Record<RuleStatus, number> = { met: 0, unavailable: 1, watching: 2, triggered: 3, paused: 4 };

function StatusCell({ row }: { row: RuleRow }) {
  const { t } = usePrefs();
  const words = t.alerts.status;
  if (row.status === "unavailable") {
    const reason = row.reading?.unavailable;
    return (
      <span className="text-warn" title={reason ? t.alerts.reasons[reason] : undefined}>
        {reason ? t.alerts.reasons[reason] : words.unavailable}
      </span>
    );
  }
  if (row.status === "met") return <span className="font-medium text-fg">{words.met}</span>;
  if (row.status === "triggered") return <Badge>{words.triggered}</Badge>;
  return <span className={row.status === "paused" ? "text-fg-3" : "text-fg-2"}>{words[row.status]}</span>;
}

function NotificationStatus() {
  const { t } = usePrefs();
  const permission = useNotificationPermission();
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const words = t.alerts.permission;
  return (
    <div className="space-y-2 border-t border-line px-3 py-3">
      <div className="col-head">{t.alerts.page.notifications}</div>
      <p className="text-sm text-fg-2">{words[permission]}</p>
      {permission === "default" ? (
        <Button size="sm" onClick={() => void requestNotificationPermission()}>
          {words.enable}
        </Button>
      ) : null}
    </div>
  );
}

function HowItWorks() {
  const { t } = usePrefs();
  const items = t.alerts.page.howItems;
  return (
    // Fills its column next to History on wide screens, so no empty block shows under the shorter of the two.
    <Panel title={t.alerts.page.how} className="flex-1">
      <ul className="space-y-2 px-3 py-3 text-sm text-fg-2">
        {[items.cadence, items.catchUp, items.oneTab, items.local, items.notAdvice].map((text) => (
          <li key={text} className="flex gap-2.5">
            <span aria-hidden className="mt-[0.6em] size-1 shrink-0 bg-fg-3" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <NotificationStatus />
    </Panel>
  );
}

function RulesPanel() {
  const { t, lang } = usePrefs();
  const { openAlertEditor } = useUi();
  const toast = useToast();
  const hydrated = useHydrated();
  const now = useNow(30_000);
  const rules = useAlertRules();
  const { holdings } = useHoldings();
  const { symbols: watchlist } = useWatchlist();
  const ruleSymbols = useMemo(() => rules.map((rule) => rule.symbol), [rules]);
  const { quotes, data, error, settled, stale, staleSince, retry } = useQuoteMap(ruleSymbols);
  const words = t.alerts.page;

  const rows = useMemo<RuleRow[]>(
    () =>
      rules.map((rule) => {
        const quote = quotes.get(rule.symbol);
        const { status, reading } = now ? ruleStatus(rule, quote, holdings, now, settled) : { status: "watching" as const, reading: null };
        return { rule, quote, status, reading };
      }),
    [rules, quotes, holdings, now, settled],
  );

  const edit = (rule: AlertRule) => {
    setAlertEditTarget(rule.id);
    openAlertEditor(rule.symbol);
  };

  const remove = (rule: AlertRule) => {
    const removed = removeAlertRule(rule.id);
    if (!removed) return;
    toast.show({
      message: tpl(t.alerts.editor.deleted, { symbol: rule.symbol, rule: describeRule(rule, t, lang) }),
      action: { label: t.alerts.undo, onAction: () => restoreAlertRule(removed.rule, removed.index) },
    });
  };

  const rearm = (row: RuleRow) => {
    const at = new Date();
    // Like a new rule, a re-armed rule whose condition already holds triggers at the next check; the toast says so.
    // The reading is taken as the re-armed rule will see it: no earlier session range and no recorded side.
    const reading = readRule({ ...row.rule, checkedSession: null, side: null }, row.quote, holdings, at);
    const holdsNow = reading.met && reading.unavailable === null;
    rearmAlertRule(row.rule.id, at, baselineFromQuote(row.quote, at));
    toast.show({ message: tpl(holdsNow ? words.rearmedMet : words.rearmed, { symbol: row.rule.symbol, rule: describeRule(row.rule, t, lang) }) });
  };

  const columns: DataTableColumn<RuleRow>[] = [
    {
      key: "symbol",
      header: words.columns.symbol,
      width: "5.5rem",
      render: (row) => (
        <Link href={stockPath(row.rule.symbol)} className="mono font-medium text-fg hover:text-accent">
          {row.rule.symbol}
        </Link>
      ),
      sortValue: (row) => row.rule.symbol,
    },
    {
      key: "rule",
      header: words.columns.rule,
      render: (row) => (
        <span className="text-fg-2" title={row.rule.note || undefined}>
          {describeRule(row.rule, t, lang)}
          {row.rule.note ? <span className="text-fg-3"> · {row.rule.note}</span> : null}
        </span>
      ),
    },
    {
      key: "last",
      header: words.columns.last,
      align: "right",
      width: "5.5rem",
      hideBelow: "sm",
      render: (row) => <TickNumber value={row.quote?.price}>{formatPrice(row.quote?.price, lang)}</TickNumber>,
    },
    {
      key: "now",
      header: words.columns.now,
      align: "right",
      width: "8rem",
      hideBelow: "lg",
      render: (row) => <span className="num text-fg-2">{describeReading(row.rule.kind, row.rule.value, row.reading, t) ?? "—"}</span>,
    },
    {
      key: "repeat",
      header: words.columns.repeat,
      width: "5rem",
      hideBelow: "xl",
      render: (row) => <span className="text-fg-2">{t.alerts.repeat[row.rule.repeat]}</span>,
    },
    {
      key: "status",
      header: words.columns.status,
      width: "8.5rem",
      render: (row) => <StatusCell row={row} />,
      sortValue: (row) => STATUS_ORDER[row.status],
    },
    {
      key: "lastTriggered",
      header: words.columns.lastTriggered,
      align: "right",
      width: "7.5rem",
      hideBelow: "md",
      render: (row) =>
        row.rule.lastTriggeredAt ? (
          <span className="num text-fg-2" title={`${formatDate(row.rule.lastTriggeredAt, lang)} ${formatTime(row.rule.lastTriggeredAt, lang)}`}>
            {formatRelativeTime(row.rule.lastTriggeredAt, lang, now?.getTime() ?? Date.parse(row.rule.lastTriggeredAt))}
          </span>
        ) : (
          <span className="text-fg-3">{words.never}</span>
        ),
      sortValue: (row) => row.rule.lastTriggeredAt,
    },
  ];

  const actions = (row: RuleRow) => {
    const { rule } = row;
    const label = (template: string) => tpl(template, { symbol: rule.symbol });
    return (
      <span className="inline-flex">
        <IconButton size="sm" label={label(words.actions.edit)} icon={<Pencil className="size-3.5" strokeWidth={1.75} />} onClick={() => edit(rule)} />
        {row.status === "triggered" ? (
          <IconButton size="sm" label={label(words.actions.rearm)} icon={<RotateCcw className="size-3.5" strokeWidth={1.75} />} onClick={() => rearm(row)} />
        ) : (
          <IconButton
            size="sm"
            label={label(rule.paused ? words.actions.resume : words.actions.pause)}
            icon={rule.paused ? <Play className="size-3.5" strokeWidth={1.75} /> : <Pause className="size-3.5" strokeWidth={1.75} />}
            onClick={() => setAlertPaused(rule.id, !rule.paused)}
          />
        )}
        <IconButton size="sm" label={label(words.actions.delete)} icon={<Trash2 className="size-3.5" strokeWidth={1.75} />} onClick={() => remove(rule)} />
      </span>
    );
  };

  const starters = watchlist.slice(0, 6).map((symbol) => ({ label: symbol, onSelect: () => openAlertEditor(symbol) }));

  return (
    <Panel
      title={words.rules}
      code="ALRT"
      actions={
        <>
          {hydrated ? <PanelMeta>{tpl(words.count, { n: rules.length, max: MAX_ALERT_RULES })}</PanelMeta> : null}
          <Button size="sm" variant="primary" onClick={() => openAlertEditor()}>
            {words.newAlert}
          </Button>
        </>
      }
    >
      <p className="border-b border-line px-3 py-2 text-xs text-fg-2">{t.alerts.honest}</p>
      <StaleBanner show={stale} since={staleSince} />
      {error && !data ? <ErrorState compact error={error} onRetry={retry} className="border-b border-line" /> : null}
      <DataTable
        rows={hydrated ? rows : []}
        columns={columns}
        rowKey={(row) => row.rule.id}
        caption={words.rulesCaption}
        rowActions={actions}
        actionsWidth="6.5rem"
        actionsTouchWidth="8rem"
        minWidth="34rem"
        loading={!hydrated}
        loadingRows={3}
        empty={
          <EmptyState chips={starters} chipsLabel={words.emptyChips}>
            {words.empty}
          </EmptyState>
        }
      />
    </Panel>
  );
}

function HistoryPanel() {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const hydrated = useHydrated();
  const now = useNow(30_000);
  const log = useAlertLog();
  const words = t.alerts.page;
  const unseen = hydrated ? unseenCount(log) : 0;

  const clear = () => {
    const cleared = clearAlertLog();
    if (cleared.length === 0) return;
    toast.show({ message: words.historyCleared, action: { label: t.alerts.undo, onAction: () => restoreAlertLog(cleared) } });
  };

  const columns: DataTableColumn<AlertEvent>[] = [
    {
      key: "time",
      header: words.columns.time,
      width: "6.5rem",
      render: (event) => (
        <span className={cn("num", event.seen ? "text-fg-3" : "text-fg-2")} title={`${formatDate(event.at, lang)} ${formatTime(event.at, lang)}`}>
          {formatRelativeTime(event.at, lang, now?.getTime() ?? Date.parse(event.at))}
        </span>
      ),
      sortValue: (event) => event.at,
      firstSort: "desc",
    },
    {
      key: "symbol",
      header: words.columns.symbol,
      width: "5.5rem",
      hideBelow: "sm",
      render: (event) => (
        <Link href={stockPath(event.symbol)} className="mono font-medium text-fg hover:text-accent">
          {event.symbol}
        </Link>
      ),
      sortValue: (event) => event.symbol,
    },
    {
      key: "alert",
      header: words.columns.alert,
      // Messages wrap instead of disappearing behind an ellipsis on narrow screens.
      className: "whitespace-normal py-1.5",
      render: (event) => {
        const text = describeAlertEvent(event, t, lang, "log");
        return (
          <span className="flex min-w-0 items-start gap-2" title={event.note ? `${text} · ${event.note}` : text}>
            <span aria-hidden className={cn("mt-[0.45rem] size-1.5 shrink-0 rounded-full", event.seen ? "bg-transparent" : "bg-accent")} />
            <span className="min-w-0 flex-1">
              {event.seen ? null : <span className="sr-only">{t.alerts.bell.unseenItem}: </span>}
              <span className={event.seen ? "text-fg-2" : "text-fg"}>{text}</span>
              {event.missed ? <Badge className="ml-2 align-[1px]">{t.alerts.event.missedBadge}</Badge> : null}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <Panel
      title={words.history}
      // Fills its column next to "How alerts work" on wide screens, so no empty block shows under it.
      className="flex-1"
      actions={
        hydrated && log.length > 0 ? (
          <>
            {unseen > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => markAlertEventsSeen()}>
                {t.alerts.bell.markAllSeen}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={clear}>
              {words.clearHistory}
            </Button>
          </>
        ) : undefined
      }
    >
      <DataTable
        rows={hydrated ? log : []}
        columns={columns}
        rowKey={(event) => event.id}
        caption={words.historyCaption}
        loading={!hydrated}
        loadingRows={3}
        empty={words.historyEmpty}
        maxHeight="min(60vh, 560px)"
        stickyHeader
      />
    </Panel>
  );
}

/** /alerts (ALRT): the rules with their status, the trigger history and how local alerts work. */
export function AlertsView() {
  const { t } = usePrefs();
  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <h1 className="sr-only">{t.alerts.title}</h1>
      {/* The rules table is the page: it spans both columns, then history and the explanation sit side by side. */}
      <div className="min-w-0 xl:col-span-2">
        <RulesPanel />
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <HistoryPanel />
      </div>
      <div className="flex min-w-0 flex-col gap-px">
        <HowItWorks />
      </div>
    </div>
  );
}
