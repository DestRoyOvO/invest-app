// View choices on the portfolio page: the tab (in the URL, so CORR can link to ?tab=correlation) and the benchmark and
// range of the performance chart (a per-viewer convenience in localStorage).

import { createLocalStore } from "@/lib/local-store";
import { PERFORMANCE_SESSIONS, type PerformanceRange } from "@/lib/portfolio-analytics";

export const PORT_TABS = ["overview", "exposure", "risk", "correlation"] as const;
export type PortTab = (typeof PORT_TABS)[number];

/** The tab named by a ?tab= value; the overview for anything else. */
export function parsePortTab(value: string | string[] | null | undefined): PortTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (PORT_TABS as readonly string[]).includes(raw ?? "") ? (raw as PortTab) : "overview";
}

export const PORT_BENCHMARKS = ["SPY", "QQQ"] as const;
export type PortBenchmark = (typeof PORT_BENCHMARKS)[number];

export interface PortViewPrefs {
  benchmark: PortBenchmark;
  range: PerformanceRange;
}

export const PORT_VIEW_KEY = "investseek:port:v1";
const EMPTY: PortViewPrefs = { benchmark: "SPY", range: "1y" };

export function sanitizePortView(raw: unknown): PortViewPrefs {
  if (!raw || typeof raw !== "object") return EMPTY;
  const { benchmark, range } = raw as { benchmark?: unknown; range?: unknown };
  return {
    benchmark: (PORT_BENCHMARKS as readonly unknown[]).includes(benchmark) ? (benchmark as PortBenchmark) : EMPTY.benchmark,
    range: typeof range === "string" && range in PERFORMANCE_SESSIONS ? (range as PerformanceRange) : EMPTY.range,
  };
}

export const portViewStore = createLocalStore<PortViewPrefs>({ key: PORT_VIEW_KEY, sanitize: sanitizePortView, empty: EMPTY });
