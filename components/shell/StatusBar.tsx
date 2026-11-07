"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useAuthStatus, useOverview } from "@/hooks/useApi";
import { formatTime, tpl } from "@/lib/format";

import { aiStateOf } from "./AiStatus";
import { StateDot } from "./MarketClock";

/** Bottom status line (tablet and desktop). */
export function StatusBar() {
  const { t, lang } = usePrefs();
  const { data, error } = useOverview();
  const { data: auth } = useAuthStatus();
  const ai = aiStateOf(auth);
  const state = data?.marketState ?? null;

  return (
    <footer className="hidden h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-xs text-fg-3 md:flex">
      <span className="flex items-center gap-1.5">
        <StateDot state={state} />
        <span className="text-fg-2">{state ? t.shell.marketState[state] : t.shell.marketState.unknown}</span>
      </span>
      <span>{t.shell.dataSource}</span>
      {data ? <span className="num">{tpl(t.common.updated, { time: formatTime(data.asOf, lang, undefined, true) })}</span> : null}
      {error && data ? <span className="text-warn">{t.common.staleData}</span> : null}
      <span className="ml-auto">{ai === "unknown" ? null : t.shell.ai[ai]}</span>
      <span className="num hidden lg:inline">/ · G M · G W · G S</span>
    </footer>
  );
}
