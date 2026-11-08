// The alert engine's bookkeeping, free of React and browser APIs so it can be tested: hooks/useAlertEngine.ts feeds it
// quotes and holdings, and gives it a way to load daily bars and to notify.
//
// Each check runs lib/alerts.ts planChecks over the stored rules. Price rules left unchecked for a while are replayed
// from daily bars first (a few symbols at a time, with retries), and only then checked live again. Triggers are written
// at once; routine check bookkeeping (time, session range) is written at most once a minute and when the tab hides, so
// an open tab does not rewrite storage every few seconds.

import {
  alertsStore,
  applyAlertPatches,
  canCatchUp,
  catchUp,
  isActive,
  needsCatchUp,
  planChecks,
  recordAlertEvents,
  type AlertBar,
  type AlertEvent,
  type AlertHoldings,
  type AlertQuote,
  type AlertRule,
} from "@/lib/alerts";
import type { ChartRange } from "@/types/api";

/** How often routine check results are written to storage. */
export const FLUSH_INTERVAL_MS = 60_000;
/** Replays loading at the same time (each is one chart request). */
export const MAX_PARALLEL_REPLAYS = 4;
/** Attempts per replay before its rules go back to live checks (the gap is then not reported). */
export const REPLAY_ATTEMPTS = 3;
const RETRY_BASE_MS = 60_000;

export interface AlertEngineDeps {
  /** Daily bars for a symbol over a range; resolve [] for a symbol without data, reject for a failure worth retrying. */
  fetchBars: (symbol: string, range: ChartRange) => Promise<readonly AlertBar[]>;
  /** Called with events that were newly logged (never twice for one id); see also setNotifier. */
  notify?: (events: readonly AlertEvent[]) => void;
  now?: () => Date;
}

export interface AlertEngine {
  /** Replaces the notifier, e.g. when the language changes. */
  setNotifier: (notify: (events: readonly AlertEvent[]) => void) => void;
  /** Latest inputs; call check() after. */
  setInputs: (quotes: ReadonlyMap<string, AlertQuote>, holdings: AlertHoldings) => void;
  /** Runs one pass: live checks, writes and replays. */
  check: () => void;
  /** Writes pending check bookkeeping now (on hide, unmount or losing the lead). */
  flush: () => void;
  /** Writes what is pending and stops checking; replays still loading are ignored. */
  stop: () => void;
  /** Checks again after stop() (React mounts effects twice in development). */
  start: () => void;
}

interface Replay {
  inFlight: boolean;
  attempts: number;
  retryAt: number;
}

export function createAlertEngine({ fetchBars, notify: initialNotify, now = () => new Date() }: AlertEngineDeps): AlertEngine {
  let notify = initialNotify ?? (() => {});
  let quotes: ReadonlyMap<string, AlertQuote> = new Map();
  let holdings: AlertHoldings = {};
  let pending = new Map<string, Partial<AlertRule>>();
  const armedSeen = new Map<string, string>();
  const replays = new Map<string, Replay>();
  const gaveUp = new Set<string>();
  let lastFlush = 0;
  let stopped = false;

  /** The stored rule with this tab's unwritten check results, unless it was re-armed since. */
  const merged = (rule: AlertRule): AlertRule => {
    const patch = pending.get(rule.id);
    return patch && armedSeen.get(rule.id) === rule.armedAt ? { ...rule, ...patch } : rule;
  };

  const flush = () => {
    if (pending.size > 0) applyAlertPatches(pending, armedSeen);
    pending = new Map();
    lastFlush = now().getTime();
  };

  const deliver = (events: readonly AlertEvent[]) => {
    const added = recordAlertEvents(events);
    if (added.length > 0) notify(added);
  };

  const finishReplay = (symbol: string, bars: readonly AlertBar[]) => {
    const at = now();
    const patches = new Map<string, Partial<AlertRule>>();
    const seen = new Map<string, string>();
    const events: AlertEvent[] = [];
    for (const rule of alertsStore.getSnapshot()) {
      const current = merged(rule);
      if (rule.symbol !== symbol || !needsCatchUp(current, at)) continue;
      const result = catchUp(current, bars, at, quotes.get(symbol)?.currency ?? null);
      patches.set(rule.id, result.patch);
      seen.set(rule.id, rule.armedAt);
      pending.delete(rule.id);
      if (result.event) events.push(result.event);
    }
    applyAlertPatches(patches, seen);
    deliver(events);
  };

  const startReplay = (symbol: string, range: ChartRange) => {
    const state = replays.get(symbol);
    if (state?.inFlight || (state && now().getTime() < state.retryAt)) return;
    if ([...replays.values()].filter((r) => r.inFlight).length >= MAX_PARALLEL_REPLAYS) return;
    const replay: Replay = { inFlight: true, attempts: state?.attempts ?? 0, retryAt: 0 };
    replays.set(symbol, replay);
    fetchBars(symbol, range).then(
      (bars) => {
        replays.delete(symbol);
        if (!stopped) finishReplay(symbol, bars);
      },
      () => {
        replay.inFlight = false;
        replay.attempts += 1;
        if (replay.attempts < REPLAY_ATTEMPTS) {
          replay.retryAt = now().getTime() + RETRY_BASE_MS * replay.attempts;
          return;
        }
        replays.delete(symbol);
        for (const rule of alertsStore.getSnapshot()) if (rule.symbol === symbol && canCatchUp(rule)) gaveUp.add(rule.id);
      },
    );
  };

  const check = () => {
    if (stopped) return;
    const at = now();
    const rules = alertsStore.getSnapshot();
    // Forget unwritten results of rules deleted, paused, fired or re-armed meanwhile.
    for (const id of [...pending.keys()]) {
      const rule = rules.find((r) => r.id === id);
      if (!rule || !isActive(rule) || armedSeen.get(id) !== rule.armedAt) pending.delete(id);
    }
    const current = rules.map(merged);
    const catchingUp = new Set([...replays].filter(([, r]) => r.inFlight).map(([symbol]) => symbol));
    const plan = planChecks(current, quotes, holdings, at, { catchingUp, skipCatchUp: gaveUp });
    let urgent = plan.events.length > 0;
    for (const [id, patch] of plan.patches) {
      const rule = current.find((r) => r.id === id);
      if (!rule) continue;
      // A changed side of the 200-day average must survive a reload, or the next cross would go unnoticed.
      if (patch.side !== undefined && patch.side !== rule.side) urgent = true;
      pending.set(id, { ...pending.get(id), ...patch });
      armedSeen.set(id, rule.armedAt);
      // Checked live again after a replay that failed for good: a later gap (a laptop asleep overnight) is replayed
      // again instead of skipped for the life of the tab.
      gaveUp.delete(id);
    }
    if (urgent || at.getTime() - lastFlush >= FLUSH_INTERVAL_MS) flush();
    deliver(plan.events);
    for (const { symbol, range } of plan.catchUps) startReplay(symbol, range);
  };

  return {
    setNotifier(next) {
      notify = next;
    },
    setInputs(nextQuotes, nextHoldings) {
      quotes = nextQuotes;
      holdings = nextHoldings;
    },
    check,
    flush,
    stop() {
      flush();
      stopped = true;
    },
    start() {
      stopped = false;
    },
  };
}
