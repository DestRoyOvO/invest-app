"use client";

import { Search } from "lucide-react";
import Link from "next/link";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Kbd } from "@/components/ui/Badge";
import { useOverview } from "@/hooks/useApi";

import { AiStatusButton } from "./AiStatus";
import { MarketClock } from "./MarketClock";
import { SettingsMenu } from "./SettingsMenu";

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="num flex size-6 items-center justify-center rounded-xs bg-accent text-[0.6875rem] font-semibold text-accent-fg">
        IS
      </span>
      <span className="num hidden text-sm font-semibold tracking-[0.2em] text-fg sm:inline">INVESTSEEK</span>
    </span>
  );
}

export function TopBar() {
  const t = useT();
  const { openCommand } = useUi();
  const { data } = useOverview();

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link href="/" aria-label="InvestSeek" className="shrink-0">
        <Wordmark />
      </Link>

      <button
        type="button"
        onClick={openCommand}
        aria-label={t.shell.openCommand}
        aria-haspopup="dialog"
        className="flex h-8 min-w-0 max-w-xl flex-1 items-center gap-2 rounded-xs border border-line-2 bg-canvas px-2.5 text-left text-sm text-fg-3 transition-colors hover:border-fg-3"
      >
        <span aria-hidden className="num text-accent">
          &gt;
        </span>
        <span className="min-w-0 flex-1 truncate">{t.shell.commandPlaceholder}</span>
        <Search aria-hidden className="size-4 sm:hidden" strokeWidth={1.75} />
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>/</Kbd>
        </span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="hidden pr-2 lg:block">
          <MarketClock state={data?.marketState} />
        </div>
        <AiStatusButton />
        <SettingsMenu />
      </div>
    </header>
  );
}
