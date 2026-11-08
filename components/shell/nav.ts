import {
  ArrowLeftRight,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartCandlestick,
  ChartLine,
  ChartPie,
  CircleHelp,
  Coins,
  DatabaseBackup,
  FileSpreadsheet,
  Filter,
  FlaskConical,
  Flame,
  Gauge,
  Globe,
  Grid3x3,
  Landmark,
  Layers,
  LayoutGrid,
  NotebookPen,
  Percent,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";

import { FUNCTION_GROUPS, functionByKey, NAV_LAYOUT, type FunctionDef, type FunctionGroup, type FunctionLabelKey } from "@/lib/functions";

/** One icon per function, shared by the rail, the More sheet, the command bar and /help. */
export const FUNCTION_ICONS: Readonly<Record<FunctionLabelKey, LucideIcon>> = {
  mkt: LayoutGrid,
  wei: Globe,
  gc: Percent,
  sect: Layers,
  eqs: Filter,
  most: Flame,
  wl: Star,
  port: ChartPie,
  corr: Grid3x3,
  evts: CalendarDays,
  alrt: Bell,
  notes: NotebookPen,
  qt: ChartCandlestick,
  des: Building2,
  gp: ChartLine,
  fa: FileSpreadsheet,
  ern: CalendarClock,
  anr: Users,
  dvd: Coins,
  hds: Landmark,
  risk: Gauge,
  noteSymbol: NotebookPen,
  comp: ArrowLeftRight,
  lab: FlaskConical,
  data: DatabaseBackup,
  help: CircleHelp,
};

export interface NavContext {
  lastSymbol: string;
  lastSector: string | null;
}

export interface NavItem {
  fn: FunctionDef;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  group: FunctionGroup;
  items: NavItem[];
}

export function navItem(key: FunctionLabelKey, ctx: NavContext): NavItem {
  const fn = functionByKey(key);
  const href = fn.scope === "security" ? fn.href(ctx.lastSymbol) : fn.href(undefined, { lastSector: ctx.lastSector });
  return { fn, href, icon: FUNCTION_ICONS[key] };
}

/** The rail: Markets, Portfolio, Research and Tools with the functions of NAV_LAYOUT. */
export function navGroups(ctx: NavContext): NavGroup[] {
  return FUNCTION_GROUPS.map((group) => ({ group, items: NAV_LAYOUT[group].map((key) => navItem(key, ctx)) }));
}
