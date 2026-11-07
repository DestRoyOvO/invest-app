"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";

import { EmptyState, SkeletonRows } from "./States";
import { ariaSort, nextSort, sortRows, type SortDirection, type SortState, type SortValue } from "./table-sort";

export type { SortDirection, SortState, SortValue } from "./table-sort";

export type Breakpoint = "sm" | "md" | "lg" | "xl";

// Static class names so Tailwind sees them. A hidden <col> must disappear together with its cells, or the remaining
// widths shift onto the wrong columns.
const HIDE_CELL: Record<Breakpoint, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};
const HIDE_COL: Record<Breakpoint, string> = {
  sm: "hidden sm:table-column",
  md: "hidden md:table-column",
  lg: "hidden lg:table-column",
  xl: "hidden xl:table-column",
};
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  /** Numbers align right. */
  align?: "left" | "right" | "center";
  /** Width of the <col>, e.g. "5.5rem". Leave the main text column (usually the name) without one: it takes the rest. */
  width?: string;
  render: (row: Row, index: number) => ReactNode;
  /** Makes the column sortable. Return null for missing values: they sort last in both directions. */
  sortValue?: (row: Row) => SortValue;
  /** First direction on click; defaults to descending for right-aligned columns and ascending otherwise. */
  firstSort?: SortDirection;
  /** Hides the column (header, cells and width) below this breakpoint. */
  hideBelow?: Breakpoint;
  /** Extra classes for this column's body cells. */
  className?: string;
  /** Header tooltip, e.g. the full name of an abbreviation. */
  title?: string;
}

interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rowKey: (row: Row) => string;
  /** Describes the table for screen readers (visually hidden). */
  caption: string;
  /** Controlled sort; pass null for the natural order. Leave undefined to let the table keep its own state. */
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Order of rows with equal sort values (default: their original order). */
  tieBreak?: (a: Row, b: Row) => number;
  /** Makes the whole row clickable; the first cell renders a real link for keyboard and screen reader users. */
  rowHref?: (row: Row) => string;
  /** Trailing actions, shown on row hover and keyboard focus, always on touch screens. */
  rowActions?: (row: Row) => ReactNode;
  /** Width of the actions column from sm up (default fits two 28px icon buttons). */
  actionsWidth?: string;
  /** Width below sm, where icon buttons grow to 40px (default fits two). */
  actionsTouchWidth?: string;
  rowClassName?: (row: Row) => string | undefined;
  /** Shows skeleton rows under the header while there are no rows yet. */
  loading?: boolean;
  loadingRows?: number;
  /** Shown when there are no rows; a string becomes an EmptyState. */
  empty?: ReactNode;
  /** Keeps the header visible while scrolling; pair with maxHeight inside panels. */
  stickyHeader?: boolean;
  /** Scrolls the table inside this height (e.g. "min(70vh, 720px)"). */
  maxHeight?: string;
  /** Scrolls horizontally below this width instead of squeezing columns. */
  minWidth?: string;
  /** <tr> rows for a <tfoot>, e.g. totals. */
  footer?: ReactNode;
  className?: string;
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role='button'],[role='menuitem']";

/**
 * Typed, sortable data table: fixed column widths from a colgroup, rows at --row-h (the density setting), sortable
 * headers with aria-sort and a stable sort, optional row links, hover-revealed row actions, loading and empty states.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  caption,
  sort,
  defaultSort = null,
  onSortChange,
  tieBreak,
  rowHref,
  rowActions,
  actionsWidth = "4.5rem",
  actionsTouchWidth = "5.5rem",
  rowClassName,
  loading = false,
  loadingRows = 6,
  empty,
  stickyHeader = false,
  maxHeight,
  minWidth,
  footer,
  className,
}: DataTableProps<Row>) {
  const t = useT();
  const router = useRouter();
  const [ownSort, setOwnSort] = useState<SortState | null>(defaultSort);
  const activeSort = sort !== undefined ? sort : ownSort;

  const sorted = useMemo(() => {
    const column = activeSort ? columns.find((c) => c.key === activeSort.key) : undefined;
    if (!activeSort || !column?.sortValue) return rows;
    return sortRows(rows, column.sortValue, activeSort.direction, tieBreak);
  }, [rows, columns, activeSort, tieBreak]);

  const onHeaderClick = (column: DataTableColumn<Row>) => {
    const next = nextSort(activeSort, column.key, column.firstSort ?? (column.align === "right" ? "desc" : "asc"));
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
  };

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    // Selecting text in a row should not navigate away.
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  };

  const columnCount = columns.length + (rowActions ? 1 : 0);
  const headClass = cn("h-8 shadow-[inset_0_-1px_0_var(--line)]", stickyHeader && "sticky top-0 z-10 bg-panel");

  let body: ReactNode;
  if (loading && rows.length === 0) {
    body = (
      <tr>
        <td colSpan={columnCount} className="p-0">
          <SkeletonRows rows={loadingRows} />
        </td>
      </tr>
    );
  } else if (sorted.length === 0) {
    body = (
      <tr>
        <td colSpan={columnCount} className="p-0 whitespace-normal">
          {empty === undefined || typeof empty === "string" ? <EmptyState>{empty ?? t.common.noResults}</EmptyState> : empty}
        </td>
      </tr>
    );
  } else {
    body = sorted.map((row, index) => {
      const href = rowHref?.(row);
      return (
        <tr
          key={rowKey(row)}
          onClick={href ? (event) => onRowClick(event, href) : undefined}
          className={cn("group/row h-row border-b border-line/70 transition-colors last:border-b-0 hover:bg-hover", href && "cursor-pointer", rowClassName?.(row))}
        >
          {columns.map((column, columnIndex) => {
            const content = column.render(row, index);
            return (
              <td
                key={column.key}
                className={cn("truncate px-3", ALIGN[column.align ?? "left"], column.hideBelow && HIDE_CELL[column.hideBelow], column.className)}
              >
                {columnIndex === 0 && href ? (
                  <Link href={href} className="hover:text-accent focus-visible:outline-offset-[-2px]">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </td>
            );
          })}
          {rowActions ? (
            <td className="pr-2 text-right">
              <span className="inline-flex items-center justify-end opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
                {rowActions(row)}
              </span>
            </td>
          ) : null}
        </tr>
      );
    });
  }

  return (
    <div className={cn(maxHeight ? "overflow-auto" : "overflow-x-auto", className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full table-fixed border-collapse text-data" style={minWidth ? { minWidth } : undefined}>
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} className={column.hideBelow ? HIDE_COL[column.hideBelow] : undefined} style={column.width ? { width: column.width } : undefined} />
          ))}
          {rowActions ? (
            <col className="w-(--dt-actions) max-sm:w-(--dt-actions-touch)" style={{ "--dt-actions": actionsWidth, "--dt-actions-touch": actionsTouchWidth } as CSSProperties} />
          ) : null}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => {
              const direction = ariaSort(activeSort, column.key);
              const align = column.align ?? "left";
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={direction}
                  title={column.title}
                  className={cn(
                    "col-head whitespace-nowrap",
                    headClass,
                    // A sort button fills its cell, so the whole head is the target (40px tall on phones).
                    !column.sortValue && "px-3",
                    ALIGN[align],
                    column.hideBelow && HIDE_CELL[column.hideBelow],
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => onHeaderClick(column)}
                      className={cn(
                        "flex h-8 w-full items-center gap-1 px-3 tracking-[inherit] uppercase transition-colors hover:text-fg focus-visible:outline-offset-[-2px] max-sm:h-10",
                        align === "right" && "flex-row-reverse",
                        align === "center" && "justify-center",
                        direction ? "text-fg-2" : undefined,
                      )}
                    >
                      <span className="truncate">{column.header}</span>
                      {direction === "ascending" ? (
                        <ArrowUp aria-hidden className="size-3 shrink-0" strokeWidth={2} />
                      ) : direction === "descending" ? (
                        <ArrowDown aria-hidden className="size-3 shrink-0" strokeWidth={2} />
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
            {rowActions ? <td aria-hidden className={cn(headClass, "px-3")} /> : null}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
