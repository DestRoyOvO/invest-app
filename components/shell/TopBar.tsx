"use client";

import { Search } from "lucide-react";
import Link from "next/link";

import { AlertBell } from "@/components/alerts/AlertBell";
import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Kbd } from "@/components/ui/Badge";
import { Wordmark } from "@/components/ui/Wordmark";
import { useBoard } from "@/hooks/useShellApi";

import { AiStatusButton } from "./AiStatus";
import { MarketClock } from "./MarketClock";
import { SessionRibbon } from "./SessionRibbon";
import { SettingsMenu } from "./SettingsMenu";

export function TopBar() {
  const t = useT();
  const { openCommand } = useUi();
  const { data } = useBoard();
  const state = data?.marketState;

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 bg-panel px-3 sm:gap-3">
        <Link href="/" aria-label="InvestSeek" className="shrink-0">
          <Wordmark />
        </Link>

        {/* The accessible name starts with the visible placeholder (WCAG 2.5.3) and adds what the button does. */}
        <button
          type="button"
          onClick={openCommand}
          aria-label={`${t.shell.commandPlaceholder}, ${t.shell.openCommand}`}
          aria-haspopup="dialog"
          aria-keyshortcuts="/ Control+K Meta+K"
          className="flex h-8 min-w-0 max-w-xl flex-1 items-center gap-2 rounded-xs border border-input-border bg-input-bg px-2.5 text-left text-sm text-fg-3 transition-colors hover:border-fg-3 max-sm:h-10"
        >
          <span aria-hidden className="mono text-accent">
            &gt;
          </span>
          <span className="min-w-0 flex-1 truncate">{t.shell.commandPlaceholder}</span>
          <Search aria-hidden className="size-4 shrink-0 sm:hidden" strokeWidth={1.75} />
          <span aria-hidden className="hidden items-center gap-1 sm:flex">
            <Kbd>/</Kbd>
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="hidden pr-2 lg:block">
            <MarketClock state={state} />
          </div>
          <div className="pr-1 lg:hidden">
            <MarketClock state={state} compact />
          </div>
          <AlertBell />
          <AiStatusButton />
          <SettingsMenu />
        </div>
      </header>
      <SessionRibbon state={state} />
    </>
  );
}
