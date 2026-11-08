// Chart workstation settings (range, extended hours, studies, log scale), stored only in this browser under
// investseek:chart:v1 (lib/local-store.ts), so every quote page opens the way the investor left it.

import { createLocalStore } from "@/lib/local-store";
import type { ChartRange } from "@/types/api";

import { RANGES } from "./chart-utils";

export interface ChartSettings {
  range: ChartRange;
  /** Show pre- and post-market bars on the 1D and 5D charts. */
  extended: boolean;
  ma20: boolean;
  ma50: boolean;
  ma200: boolean;
  bollinger: boolean;
  rsi: boolean;
  volume: boolean;
  log: boolean;
}

export type ChartStudy = "ma20" | "ma50" | "ma200" | "bollinger" | "rsi" | "volume" | "log";

export const CHART_STUDIES: readonly ChartStudy[] = ["ma20", "ma50", "ma200", "bollinger", "rsi", "volume", "log"];

export const CHART_SETTINGS_KEY = "investseek:chart:v1";

export const DEFAULT_CHART_SETTINGS: ChartSettings = Object.freeze({
  range: "1y",
  extended: false,
  ma20: true,
  ma50: true,
  ma200: false,
  bollinger: false,
  rsi: false,
  volume: true,
  log: false,
});

/** Keeps known keys with valid values; anything else falls back to the default. */
export function sanitizeChartSettings(raw: unknown): ChartSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_CHART_SETTINGS;
  const r = raw as Record<string, unknown>;
  const flag = (key: keyof ChartSettings) => (typeof r[key] === "boolean" ? (r[key] as boolean) : (DEFAULT_CHART_SETTINGS[key] as boolean));
  return {
    range: typeof r.range === "string" && (RANGES as readonly string[]).includes(r.range) ? (r.range as ChartRange) : DEFAULT_CHART_SETTINGS.range,
    extended: flag("extended"),
    ma20: flag("ma20"),
    ma50: flag("ma50"),
    ma200: flag("ma200"),
    bollinger: flag("bollinger"),
    rsi: flag("rsi"),
    volume: flag("volume"),
    log: flag("log"),
  };
}

export const chartSettingsStore = createLocalStore<ChartSettings>({
  key: CHART_SETTINGS_KEY,
  sanitize: sanitizeChartSettings,
  empty: DEFAULT_CHART_SETTINGS,
});

export function updateChartSettings(patch: Partial<ChartSettings>): void {
  chartSettingsStore.update((current) => ({ ...current, ...patch }));
}
