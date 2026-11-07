"use client";

import { AlertTriangle } from "lucide-react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Kbd } from "@/components/ui/Badge";
import { useAuthStatus } from "@/hooks/useApi";
import { useBoard } from "@/hooks/useShellApi";
import { tpl } from "@/lib/format";

import { aiStateOf } from "./AiStatus";
import { delayedNotice, etLabel } from "./board-status";
import { useNow } from "./clock";
import { StateDot } from "./MarketClock";

/** Bottom status line (tablet and desktop): market state, data source and freshness, AI state and the shortcuts key. */
export function StatusBar({ goPending = false }: { goPending?: boolean }) {
  const { t, lang } = usePrefs();
  const { openShortcuts } = useUi();
  const { data, error } = useBoard();
  const { data: auth } = useAuthStatus();
  const now = useNow("halfMinute");
  const ai = aiStateOf(auth);
  const state = data?.marketState ?? null;
  const delayed = delayedNotice(t, data, Boolean(error && data), lang, now);

  return (
    <footer className="hidden h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-xs text-fg-3 md:flex">
      <span className="flex items-center gap-1.5">
        <StateDot state={state} />
        <span className="text-fg-2">{state ? t.shell.marketState[state] : t.shell.marketState.unknown}</span>
      </span>
      <span className="hidden lg:inline">{t.shell.dataSource}</span>
      {delayed ? (
        // Shown here and announced once through the live region below (the refresh time changes too often to announce).
        <span aria-hidden className="flex min-w-0 items-center gap-1.5 text-warn">
          <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{delayed}</span>
        </span>
      ) : data ? (
        <span className="num truncate">{tpl(t.common.updated, { time: etLabel(t, data.asOf, lang, now) })}</span>
      ) : null}
      <span role="status" className="sr-only">
        {delayed ?? ""}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-4">
        {goPending ? (
          <span aria-hidden className="mono text-accent">
            G · {t.shell.goPending}
          </span>
        ) : null}
        {ai === "unknown" ? null : <span>{t.shell.ai[ai]}</span>}
        <button
          type="button"
          onClick={openShortcuts}
          aria-haspopup="dialog"
          aria-keyshortcuts="?"
          className="-mr-1.5 flex h-6 items-center gap-1.5 rounded-xs px-1.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg"
        >
          <Kbd>?</Kbd>
          {t.shell.shortcuts}
        </button>
      </span>
    </footer>
  );
}
