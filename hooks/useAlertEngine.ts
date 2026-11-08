"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { describeAlertEvent } from "@/components/alerts/describe";
import { createAlertEngine } from "@/components/alerts/engine";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { useToast } from "@/components/ui/Toast";
import { useAlertLog, useAlertRules, useQuoteMap } from "@/hooks/useAlerts";
import { useHoldings } from "@/hooks/useHoldings";
import { ApiError, fetchJson, stockPath } from "@/lib/api-client";
import { alertLogStore, isActive, markAlertEventsSeen, type AlertBar, type AlertEvent } from "@/lib/alerts";
import type { ChartData, ChartRange } from "@/types/api";

const LOCK_NAME = "investseek:alert-engine";
const NO_SYMBOLS: readonly string[] = [];
/** Triggers older than this when they reach a tab are listed in the alert center but not shown as a toast. */
const TOAST_WINDOW_MS = 2 * 60_000;
const MAX_NOTIFICATIONS = 3;

const noopSubscribe = () => () => {};

/**
 * True while this tab holds the alert lock (Web Locks API), so exactly one tab per browser checks rules and sends
 * system notifications; when that tab closes, the lock passes to another open tab. Browsers without Web Locks check
 * in every tab, and the deterministic event ids still log each trigger once.
 */
function useLeaderLock(enabled: boolean): boolean {
  const supported = useSyncExternalStore(noopSubscribe, () => "locks" in navigator, () => false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled || !supported) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    navigator.locks
      .request(LOCK_NAME, { signal: controller.signal }, () => {
        setHeld(true);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {
        // Aborted while waiting for another tab to let go.
      });
    return () => {
      controller.abort();
      release?.();
      setHeld(false);
    };
  }, [enabled, supported]);
  return enabled && (supported ? held : true);
}

async function fetchBars(symbol: string, range: ChartRange): Promise<readonly AlertBar[]> {
  try {
    const chart = await fetchJson<ChartData>(`/api/stock/${encodeURIComponent(symbol)}/chart?range=${range}`);
    return chart.interval === "1d" ? chart.bars : [];
  } catch (error) {
    // An unknown or delisted symbol has nothing to replay; other failures are retried.
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return [];
    throw error;
  }
}

/**
 * Runs the local alert rules while the app is open (mounted once, through AlertEngine in the shell). The tab holding
 * the lock polls quotes for the alert symbols, also while hidden, replays missed price levels from daily bars, logs
 * triggers and sends a system notification when permitted and the tab is not in front.
 */
export function useAlertEngine(): void {
  const { t, lang } = usePrefs();
  const router = useRouter();
  const rules = useAlertRules();
  const symbols = useMemo(() => [...new Set(rules.filter(isActive).map((rule) => rule.symbol))].sort(), [rules]);
  const leader = useLeaderLock(symbols.length > 0);
  const { holdings } = useHoldings();
  const { quotes, data } = useQuoteMap(leader ? symbols : NO_SYMBOLS, { whenHidden: true });

  const [engine] = useState(() => createAlertEngine({ fetchBars }));

  // Declared first so a development double mount restarts the engine before the check below runs.
  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  useEffect(() => {
    engine.setNotifier((events: readonly AlertEvent[]) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      // In front, the toast already says it.
      if (document.visibilityState === "visible" && document.hasFocus()) return;
      for (const event of events.slice(0, MAX_NOTIFICATIONS)) {
        try {
          const notification = new Notification(t.alerts.notifyTitle, { body: describeAlertEvent(event, t, lang), tag: event.id, icon: "/icon.svg" });
          notification.onclick = () => {
            window.focus();
            markAlertEventsSeen([event.id]);
            router.push(stockPath(event.symbol));
            notification.close();
          };
        } catch {
          // Some mobile browsers only show notifications from a service worker; the log and the toast still have it.
        }
      }
    });
  }, [engine, t, lang, router]);

  // Check on every quote refresh, and right away when rules change (a new rule is checked against the quotes already
  // loaded instead of waiting up to a minute for the next refresh). Writes by the engine itself are idempotent.
  useEffect(() => {
    if (!leader || !data) return;
    engine.setInputs(quotes, holdings);
    engine.check();
  }, [engine, leader, data, quotes, holdings, rules]);

  // Write the routine check results when the tab hides or closes, and when this tab stops leading.
  useEffect(() => {
    if (!leader) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") engine.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", engine.flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", engine.flush);
      engine.flush();
    };
  }, [engine, leader]);
}

/**
 * Shows a toast in this tab for each new trigger in the log, whichever tab logged it, with a link to the symbol.
 * Triggers already in the log when the tab opened, or older than two minutes, stay in the alert center only.
 */
export function useAlertToasts(): void {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const router = useRouter();
  const log = useAlertLog();
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (known.current === null) known.current = new Set(alertLogStore.getSnapshot().map((event) => event.id));
    const seen = known.current;
    const fresh = log.filter((event) => !seen.has(event.id));
    for (const event of fresh) seen.add(event.id);
    const now = Date.now();
    const recent = fresh.filter((event) => !event.seen && now - Date.parse(event.at) < TOAST_WINDOW_MS).slice(0, 3);
    for (const event of recent.reverse()) {
      toast.show({
        id: `alert:${event.id}`,
        message: describeAlertEvent(event, t, lang),
        duration: 10_000,
        action: {
          label: t.alerts.view,
          onAction: () => {
            markAlertEventsSeen([event.id]);
            router.push(stockPath(event.symbol));
          },
        },
      });
    }
  }, [log, toast, router, t, lang]);
}
