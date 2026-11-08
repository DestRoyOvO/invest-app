"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { PanelCode } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Tabs } from "@/components/ui/Tabs";
import { useScreener } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { formatTime, tpl } from "@/lib/format";
import {
  capParam,
  DEFAULT_DISCOVER_CAP,
  DISCOVER_CAPS,
  parseCapParam,
  screenFromParams,
  screenToQuery,
  type DiscoverCap,
  type Screen,
} from "@/lib/screens";
import type { ScreenerUniverse } from "@/types/api";

import { capLabel, DiscoverTab } from "./DiscoverTab";
import { ScreenerTab } from "./ScreenerTab";

export type ScreenerViewTab = "screener" | "discover";

interface ViewState {
  tab: ScreenerViewTab;
  screen: Screen;
  cap: DiscoverCap;
}

function stateFrom(params: URLSearchParams): ViewState {
  return { tab: params.get("tab") === "discover" ? "discover" : "screener", screen: screenFromParams(params), cap: parseCapParam(params.get("cap")) };
}

/** The link for what is on screen: the screen's filters on the Screener tab, the tab and floor on Discover. */
function queryOf(state: ViewState): string {
  if (state.tab === "screener") return screenToQuery(state.screen);
  const params = new URLSearchParams({ tab: "discover" });
  if (state.cap !== DEFAULT_DISCOVER_CAP) params.set("cap", capParam(state.cap));
  return params.toString();
}

/** "Snapshot 16:10 ET · rebuilt every 10 minutes" for the universe on screen (shares the table's request). */
function SnapshotMeta({ universe }: { universe: ScreenerUniverse }) {
  const { t, lang } = usePrefs();
  const { data } = useScreener(universe);
  const asOf = data && data.universe === universe ? data.asOf : null;
  return (
    <p className="num text-micro text-fg-2">
      {asOf ? `${tpl(t.screener.snapshot, { time: formatTime(asOf, lang, "America/New_York") })} · ` : null}
      {t.screener.rebuilt}
    </p>
  );
}

/**
 * /screener: the EQS screener over the 78 stocks and 26 ETFs, and the MOST tab of market-wide lists (?tab=discover).
 * What is on screen stays in the address bar (history.replaceState), so a link reopens the same screen.
 */
export function ScreenerView() {
  const { t } = usePrefs();
  const params = useSearchParams();
  const search = params.toString();
  const [state, setState] = useState<ViewState>(() => stateFrom(new URLSearchParams(search)));
  const [synced, setSynced] = useState(search);

  // A navigation to another /screener link (the command bar, back and forward) replaces the state; the URL updates
  // this view writes itself come back here equal to its own query and change nothing.
  if (search !== synced) {
    setSynced(search);
    if (search !== queryOf(state)) setState(stateFrom(new URLSearchParams(search)));
  }

  useEffect(() => {
    const query = queryOf(state);
    if (query === window.location.search.replace(/^\?/, "")) return;
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, [state]);

  const setTab = (tab: ScreenerViewTab) => setState((current) => ({ ...current, tab }));
  const setScreen = (screen: Screen) => setState((current) => ({ ...current, screen }));
  const setCap = (cap: DiscoverCap) => setState((current) => ({ ...current, cap }));
  const discover = state.tab === "discover";

  return (
    <div className={cn("flex flex-col gap-px bg-line p-px", !discover && "lg:h-full")}>
      <h1 className="sr-only">{discover ? t.discover.title : t.screener.title}</h1>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-panel-2 px-3">
        <PanelCode code={discover ? "MOST" : "EQS"} />
        <Tabs
          label={t.screener.tabs.label}
          size="md"
          value={state.tab}
          onChange={setTab}
          options={[
            { value: "screener", label: t.screener.tabs.screener },
            { value: "discover", label: t.screener.tabs.discover },
          ]}
        />
        <div className="ml-auto flex min-w-0 items-center gap-2 py-1.5">
          {discover ? (
            <>
              <span aria-hidden className="text-xs text-fg-2">
                {t.discover.minCap}
              </span>
              <Segmented
                label={t.discover.minCap}
                hideLabel
                size="sm"
                value={capParam(state.cap)}
                onChange={(value) => setCap(parseCapParam(value))}
                options={DISCOVER_CAPS.map((cap) => ({ value: capParam(cap), label: capLabel(cap) }))}
                className="w-56"
              />
            </>
          ) : (
            <SnapshotMeta universe={state.screen.universe} />
          )}
        </div>
      </div>
      <div role="tabpanel" aria-label={discover ? t.screener.tabs.discover : t.screener.tabs.screener} className={cn(!discover && "lg:min-h-0 lg:flex-1")}>
        {discover ? <DiscoverTab cap={state.cap} onCapChange={setCap} /> : <ScreenerTab screen={state.screen} onScreenChange={setScreen} />}
      </div>
    </div>
  );
}
