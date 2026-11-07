"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Kbd } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Field, Input } from "@/components/ui/Field";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/States";
import { useLastSymbol } from "@/hooks/useLastSymbol";
import { useLastSector } from "@/hooks/useRecents";
import { tpl } from "@/lib/format";
import { FUNCTION_GROUPS, FUNCTIONS, shortcutKeys, type FunctionDef } from "@/lib/functions";
import type { Messages } from "@/lib/i18n/messages";

import { CodeChip } from "./CodeChip";
import { ShortcutList } from "./ShortcutsSheet";

/** What to type for a function: the code alone, or with a symbol for symbol functions. */
function usage(fn: FunctionDef, symbol: string): string {
  if (fn.code === "COMP") return `COMP ${symbol} SPY`;
  return fn.scope === "security" ? `${symbol} ${fn.code}` : fn.code;
}

function matches(fn: FunctionDef, t: Messages, query: string): boolean {
  if (!query) return true;
  const { label, description } = t.help.functions[fn.labelKey];
  return [fn.code, label, description, ...fn.aliases].some((text) => text.toLowerCase().includes(query));
}

/** /help: every function by group, the command grammar, keyboard shortcuts, data sources and the disclaimer. */
export function HelpView() {
  const { t } = usePrefs();
  const { openCommandWith } = useUi();
  const lastSymbol = useLastSymbol();
  const lastSector = useLastSector();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const page = t.help.page;

  const allColumns = useMemo<DataTableColumn<FunctionDef>[]>(
    () => [
      { key: "code", header: page.columns.code, width: "4.75rem", render: (fn) => <CodeChip code={fn.code} />, sortValue: (fn) => fn.code },
      {
        key: "function",
        header: page.columns.function,
        render: (fn) => (
          <span className="block py-1.5">
            <span className="block text-fg">{t.help.functions[fn.labelKey].label}</span>
            <span className="block text-xs whitespace-normal text-fg-2">{t.help.functions[fn.labelKey].description}</span>
          </span>
        ),
      },
      {
        key: "usage",
        header: page.columns.usage,
        width: "8.5rem",
        hideBelow: "md",
        render: (fn) => <span className="mono text-xs text-fg-2">{usage(fn, lastSymbol)}</span>,
      },
      {
        key: "keys",
        header: page.columns.keys,
        width: "4.5rem",
        hideBelow: "sm",
        render: (fn) => {
          const keys = shortcutKeys(fn.shortcut);
          return keys.length > 0 ? (
            <span className="flex gap-1">
              {keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          ) : (
            <span className="text-fg-3">—</span>
          );
        },
      },
    ],
    [page.columns, t.help.functions, lastSymbol],
  );

  // The Type column ("NVDA GP") only helps where symbol functions are listed; elsewhere it would repeat the code.
  const columnsFor = (rows: readonly FunctionDef[]) => (rows.some((fn) => fn.scope === "security") ? allColumns : allColumns.filter((column) => column.key !== "usage"));
  const visible = FUNCTIONS.filter((fn) => matches(fn, t, q));
  const examples: Array<{ text: string; description: string }> = [
    { text: "PORT", description: page.grammar.rows.code },
    { text: `${lastSymbol} GP`, description: page.grammar.rows.tickerCode },
    { text: `GP ${lastSymbol}`, description: page.grammar.rows.codeTicker },
    { text: "FA", description: page.grammar.rows.last },
    { text: "COMP AAPL MSFT SPY", description: page.grammar.rows.compare },
    { text: "英伟达 GP", description: page.grammar.rows.chinese },
    { text: page.grammar.askExample, description: page.grammar.rows.ask },
  ];
  const sources = [page.sources.quotes, page.sources.bars, page.sources.fundamentals, page.sources.news, page.sources.macro, page.sources.rates, page.sources.ai, page.sources.stale, page.sources.times, page.sources.local];

  return (
    <div className="grid gap-px bg-line p-px xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-3 bg-panel px-3 py-3 xl:col-span-2">
        <div className="flex items-center gap-2">
          <CodeChip code="HELP" decorative />
          <h1 className="text-lg font-semibold text-fg">{page.title}</h1>
        </div>
        <p className="max-w-prose text-sm text-fg-2">{page.intro}</p>
        <div className="flex max-w-xl items-end gap-1">
          <Field label={page.search} className="min-w-0 flex-1">
            <Input
              type="search"
              className="[&::-webkit-search-cancel-button]:appearance-none"
              value={query} onChange={(event) => setQuery(event.target.value)} placeholder={page.searchPlaceholder} autoComplete="off" spellCheck={false} />
          </Field>
          {query ? <IconButton label={page.clear} icon={<X className="size-4" strokeWidth={1.75} />} onClick={() => setQuery("")} /> : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-px">
        {visible.length === 0 ? (
          <Panel title={page.functions}>
            <EmptyState>{tpl(page.noMatch, { q: query.trim() })}</EmptyState>
          </Panel>
        ) : (
          FUNCTION_GROUPS.map((group) => {
            const rows = visible.filter((fn) => fn.group === group);
            if (rows.length === 0) return null;
            const total = FUNCTIONS.filter((fn) => fn.group === group).length;
            const count = q ? tpl(page.countFiltered, { n: rows.length, total }) : tpl(page.count, { n: total });
            return (
              <Panel key={group} title={t.nav.groups[group]} actions={<PanelMeta>{count}</PanelMeta>}>
                <DataTable
                  rows={rows}
                  columns={columnsFor(rows)}
                  rowKey={(fn) => fn.labelKey}
                  caption={`${page.functions} · ${t.nav.groups[group]}`}
                  rowHref={(fn) => (fn.scope === "security" ? fn.href(lastSymbol) : fn.href(undefined, { lastSector }))}
                />
              </Panel>
            );
          })
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-px">
        <Panel title={page.grammar.title}>
          <ul className="divide-y divide-line px-3 py-1">
            {examples.map((example) => (
              <li key={example.text} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 text-fg-2">{example.description}</span>
                <button
                  type="button"
                  onClick={() => openCommandWith(example.text)}
                  title={tpl(page.grammar.tryIt, { example: example.text })}
                  className="mono shrink-0 rounded-xs border border-line-2 bg-panel-2 px-1.5 py-0.5 text-xs text-fg transition-colors hover:border-accent max-sm:min-h-10"
                >
                  {example.text}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t.help.shortcuts.title}>
          <div className="p-3">
            <ShortcutList query={query} pageKeys={false} />
          </div>
        </Panel>
        <Panel title={page.sources.title}>
          <ul className="list-disc space-y-1.5 py-3 pr-3 pl-7 text-sm text-fg-2 marker:text-fg-3">
            {sources.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Panel>
        <Panel title={page.disclaimer.title}>
          <div className="space-y-1.5 p-3 text-sm text-fg-2">
            <p>{page.disclaimer.body}</p>
            <p className="text-fg-3">{t.common.disclaimer}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
