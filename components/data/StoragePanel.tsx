"use client";

import { useMemo } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/States";
import { byteLength, countEntries, formatBytes, readPrefCookies, storedItems } from "@/lib/backup";
import { formatInteger } from "@/lib/format";

import { useStorageSnapshot } from "./hooks";
import { storeLabel } from "./labels";

interface StoredRow {
  key: string;
  label: string | null;
  count: number;
  bytes: number;
}

const PREFS_KEY = "prefs";

/** What this browser holds for the app: each stored key with its entries and size, and the display settings. */
export function StoragePanel() {
  const { t, lang } = usePrefs();
  const snapshot = useStorageSnapshot();

  const rows = useMemo<StoredRow[]>(() => {
    if (!snapshot) return [];
    const items = storedItems(snapshot).map((item) => ({ key: item.key, label: storeLabel(t, item.key), count: countEntries(item.value) ?? 1, bytes: item.bytes }));
    if (items.length === 0) return [];
    // Display settings live in cookies; the backup includes them, so they are listed with the rest.
    const cookies = Object.entries(readPrefCookies(document.cookie));
    if (cookies.length > 0) {
      items.push({ key: PREFS_KEY, label: t.data.stores.prefs, count: cookies.length, bytes: cookies.reduce((sum, [name, value]) => sum + byteLength(`${name}=${value}`), 0) });
    }
    return items;
  }, [snapshot, t]);
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);

  const columns: DataTableColumn<StoredRow>[] = [
    {
      key: "item",
      header: t.data.stored.item,
      render: (row) =>
        row.label ? (
          <span className="text-fg" title={row.key === PREFS_KEY ? undefined : row.key}>
            {row.label}
          </span>
        ) : (
          <span className="mono text-fg-2">{row.key}</span>
        ),
    },
    { key: "count", header: t.data.stored.count, align: "right", width: "4.5rem", render: (row) => <span className="num text-fg">{formatInteger(row.count, lang)}</span> },
    { key: "size", header: t.data.stored.size, align: "right", width: "5.5rem", render: (row) => <span className="num text-fg-2">{formatBytes(row.bytes)}</span> },
  ];

  return (
    <Panel title={t.data.stored.title} actions={rows.length > 0 ? <PanelMeta>{formatBytes(total)}</PanelMeta> : null}>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        caption={t.data.stored.caption}
        loading={snapshot === null}
        loadingRows={3}
        empty={
          <EmptyState
            actions={
              <a href="#paste" className="inline-flex h-7 items-center rounded-xs border border-line-2 bg-panel-2 px-2 text-xs font-medium text-fg transition-colors hover:bg-hover max-sm:h-10 max-sm:px-3">
                {t.data.stored.pasteAction}
              </a>
            }
          >
            {t.data.stored.empty}
          </EmptyState>
        }
        footer={
          rows.length > 0 ? (
            <tr className="h-row border-t border-line bg-panel-2">
              <th scope="row" className="px-3 text-left font-medium text-fg-2">
                {t.data.stored.total}
              </th>
              <td />
              <td className="num px-3 text-right text-fg">{formatBytes(total)}</td>
            </tr>
          ) : null
        }
      />
    </Panel>
  );
}
