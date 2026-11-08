"use client";

import { useMemo, useSyncExternalStore } from "react";
import useSWR from "swr";

import { useLocalStore } from "@/hooks/useLocalStore";
import { fetchJson, symbolsParam } from "@/lib/api-client";
import { alertLogStore, alertsStore, type AlertEvent, type AlertRule } from "@/lib/alerts";
import type { MarketState, Quote, QuotesResponse } from "@/types/api";

/** The alert rules (lib/alerts.ts), the same in every tab. */
export function useAlertRules(): readonly AlertRule[] {
  return useLocalStore(alertsStore);
}

/** The alert log, newest first. */
export function useAlertLog(): readonly AlertEvent[] {
  return useLocalStore(alertLogStore);
}

const CHUNK = 50;
const MAX_SYMBOLS = 200;

function trading(state: MarketState | null | undefined): boolean {
  return state === "REGULAR" || state === "PRE" || state === "POST";
}

/** The /api/quotes requests for a symbol list: unique symbols, sorted, at most MAX_SYMBOLS, 50 per request. */
export function quoteRequestUrls(symbols: readonly string[]): string[] {
  const list = [...new Set(symbols)].sort().slice(0, MAX_SYMBOLS);
  const urls: string[] = [];
  for (let i = 0; i < list.length; i += CHUNK) urls.push(`/api/quotes?symbols=${symbolsParam(list.slice(i, i + CHUNK))}`);
  return urls;
}

/** One response from several: all quotes and missing symbols, and the oldest asOf (the data is as old as its oldest part). */
export function mergeQuoteResponses(parts: readonly QuotesResponse[]): QuotesResponse {
  return {
    asOf: parts.map((part) => part.asOf).sort()[0] ?? new Date(0).toISOString(),
    quotes: parts.flatMap((part) => part.quotes),
    missing: parts.flatMap((part) => part.missing),
  };
}

async function fetchQuoteChunks(key: readonly [string, string]): Promise<QuotesResponse> {
  const parts = await Promise.all(quoteRequestUrls(key[1].split(",")).map((url) => fetchJson<QuotesResponse>(url)));
  return mergeQuoteResponses(parts);
}

export interface QuoteMap {
  quotes: ReadonlyMap<string, Quote>;
  data: QuotesResponse | undefined;
  error: unknown;
  isLoading: boolean;
  retry: () => void;
}

const EMPTY_MAP: ReadonlyMap<string, Quote> = new Map();

/**
 * Quotes for any number of symbols (requests of 50, at most 200 symbols), refreshed every 15 s while one of them
 * trades and every minute otherwise. `whenHidden` keeps refreshing in a background tab: the alert engine uses it, so
 * only that query keeps polling while the tab is hidden.
 */
export function useQuoteMap(symbols: readonly string[], { whenHidden = false }: { whenHidden?: boolean } = {}): QuoteMap {
  const joined = useMemo(() => [...new Set(symbols)].sort().slice(0, MAX_SYMBOLS).join(","), [symbols]);
  const { data, error, isLoading, mutate } = useSWR<QuotesResponse, unknown, readonly [string, string] | null>(joined ? (["quote-map", joined] as const) : null, fetchQuoteChunks, {
    refreshInterval: (latest) => (latest?.quotes.some((q) => trading(q.marketState)) ? 15_000 : 60_000),
    refreshWhenHidden: whenHidden,
  });
  const quotes = useMemo(() => (data ? new Map(data.quotes.map((q) => [q.symbol, q])) : EMPTY_MAP), [data]);
  return { quotes, data, error, isLoading, retry: () => void mutate() };
}

// ---------------------------------------------------------------------------
// The rule the global editor should open for editing (UiProvider only carries a symbol)
// ---------------------------------------------------------------------------

let editTarget: string | null = null;
const editListeners = new Set<() => void>();

/** Asks the alert editor to edit this rule the next time it opens (null for a new rule). */
export function setAlertEditTarget(ruleId: string | null): void {
  if (editTarget === ruleId) return;
  editTarget = ruleId;
  for (const listener of editListeners) listener();
}

function subscribeEditTarget(listener: () => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

export function useAlertEditTarget(): string | null {
  return useSyncExternalStore(subscribeEditTarget, () => editTarget, () => null);
}

// ---------------------------------------------------------------------------
// System notification permission
// ---------------------------------------------------------------------------

export type NotifyPermission = NotificationPermission | "unsupported";

function readPermission(): NotifyPermission {
  return typeof window === "undefined" || typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

const permissionListeners = new Set<() => void>();

function emitPermission() {
  for (const listener of permissionListeners) listener();
}

function subscribePermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  // The permission can change in the browser's site settings: re-read it when the tab regains focus, and follow the
  // Permissions API where the browser reports changes.
  window.addEventListener("focus", listener);
  let status: PermissionStatus | null = null;
  let cancelled = false;
  navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((result) => {
      if (cancelled) return;
      status = result;
      result.addEventListener("change", listener);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    permissionListeners.delete(listener);
    window.removeEventListener("focus", listener);
    status?.removeEventListener("change", listener);
  };
}

/** Whether this browser shows system notifications for the app ("unsupported" during server rendering). */
export function useNotificationPermission(): NotifyPermission {
  return useSyncExternalStore(subscribePermission, readPermission, () => "unsupported" as const);
}

/**
 * Asks for permission to show system notifications. Call it only from a click: when the first rule is saved, or from
 * the button on /alerts. Never on page load.
 */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (readPermission() !== "default") return readPermission();
  try {
    await Notification.requestPermission();
  } catch {
    // Old Safari only supports the callback form; the permission is read again below either way.
  }
  emitPermission();
  return readPermission();
}
