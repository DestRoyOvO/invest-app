// Column hiding for DataTable: below a viewport breakpoint (hideBelow) or while the table's own box is narrower than a
// container size (hideBelowContainer). Static class names so Tailwind sees them. A hidden <col> must disappear together
// with its cells, or the remaining widths shift onto the wrong columns.

/** Viewport breakpoints (Tailwind's sm 40rem, md 48rem, lg 64rem, xl 80rem). */
export type Breakpoint = "sm" | "md" | "lg" | "xl";

/**
 * Container sizes of Tailwind's `@` variants: 3xs 16rem, 2xs 18rem, xs 20rem, sm 24rem, md 28rem, lg 32rem, xl 36rem,
 * 2xl 42rem. The 22rem right-hand column at xl is a box of about 22 to 25.5rem (356px at 1280, 410px at 1440).
 */
export type ContainerBreakpoint = "3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

const VIEWPORT_CELL: Record<Breakpoint, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};
const VIEWPORT_COL: Record<Breakpoint, string> = {
  sm: "hidden sm:table-column",
  md: "hidden md:table-column",
  lg: "hidden lg:table-column",
  xl: "hidden xl:table-column",
};
const CONTAINER_CELL: Record<ContainerBreakpoint, string> = {
  "3xs": "hidden @3xs:table-cell",
  "2xs": "hidden @2xs:table-cell",
  xs: "hidden @xs:table-cell",
  sm: "hidden @sm:table-cell",
  md: "hidden @md:table-cell",
  lg: "hidden @lg:table-cell",
  xl: "hidden @xl:table-cell",
  "2xl": "hidden @2xl:table-cell",
};
const CONTAINER_COL: Record<ContainerBreakpoint, string> = {
  "3xs": "hidden @3xs:table-column",
  "2xs": "hidden @2xs:table-column",
  xs: "hidden @xs:table-column",
  sm: "hidden @sm:table-column",
  md: "hidden @md:table-column",
  lg: "hidden @lg:table-column",
  xl: "hidden @xl:table-column",
  "2xl": "hidden @2xl:table-column",
};

export interface ColumnHiding {
  hideBelow?: Breakpoint;
  hideBelowContainer?: ContainerBreakpoint;
}

/**
 * The classes that hide a column: its header and body cells (part "cell", also for the cells of a footer row a caller
 * builds) or its <col> (part "col"). A container size takes the place of a viewport breakpoint when a column has both.
 */
export function hideClass(column: ColumnHiding, part: "cell" | "col" = "cell"): string | undefined {
  if (column.hideBelowContainer) return (part === "cell" ? CONTAINER_CELL : CONTAINER_COL)[column.hideBelowContainer];
  if (column.hideBelow) return (part === "cell" ? VIEWPORT_CELL : VIEWPORT_COL)[column.hideBelow];
  return undefined;
}

/** True when a column hides by the table's width: the table's scroll box is then the query container (`@container`). */
export function queriesContainer(columns: readonly ColumnHiding[]): boolean {
  return columns.some((column) => column.hideBelowContainer !== undefined);
}
