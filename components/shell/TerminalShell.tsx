"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";

import { ChatDrawer } from "@/components/ai/ChatDrawer";
import { AlertEditorHost } from "@/components/alerts/AlertEditorHost";
import { AlertEngine } from "@/components/alerts/AlertEngine";
import { NewsDrawer } from "@/components/news/NewsDrawer";
import { PositionEditorHost } from "@/components/portfolio/PositionEditorHost";
import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { isComposing, isDialogOpen, isTypingTarget } from "@/hooks/useHotkeys";
import { useLastSymbol } from "@/hooks/useLastSymbol";
import { rememberSector, useLastSector } from "@/hooks/useRecents";
import { GO_SHORTCUTS, safeDecode } from "@/lib/functions";

import { CommandPalette } from "./CommandPalette";
import { HashLanding, openHref } from "./HashLanding";
import { MobileTabBar } from "./MobileTabBar";
import { navGroups } from "./nav";
import { NavRail } from "./NavRail";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { StatusBar } from "./StatusBar";
import { TickerStrip } from "./TickerStrip";
import { TopBar } from "./TopBar";

/** How long the second key of a "g" sequence is awaited. */
const GO_TIMEOUT_MS = 1500;

export function TerminalShell({ children, dataSource = "yahoo" }: { children: ReactNode; dataSource?: "yahoo" | "fixtures" }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { openCommand, commandOpen, openShortcuts } = useUi();
  const lastSymbol = useLastSymbol();
  const lastSector = useLastSector();
  const ctx = useMemo(() => ({ lastSymbol, lastSector }), [lastSymbol, lastSector]);
  const groups = useMemo(() => navGroups(ctx), [ctx]);
  const [goPending, setGoPending] = useState(false);
  const goTimer = useRef<number | undefined>(undefined);

  // SECT returns to the sector opened last.
  useEffect(() => {
    const match = /^\/sector\/([^/?#]+)/.exec(pathname);
    if (match) rememberSector(safeDecode(match[1]));
  }, [pathname]);

  const endGo = useEffectEvent(() => {
    window.clearTimeout(goTimer.current);
    setGoPending(false);
  });

  // Global keys: "/" or Ctrl/Cmd+K opens the command bar, "?" the shortcuts sheet, and "g" then a letter jumps to a
  // function. The listener runs in the capture phase, so a "g" sequence wins over a page hotkey on the same letter.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isComposing(event)) return;
    // Shortcuts never act behind an open dialog (command bar, drawers, editors, the settings menu).
    if (commandOpen || isDialogOpen()) {
      if (goPending) endGo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      endGo();
      openCommand();
      return;
    }
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

    if (goPending) {
      endGo();
      const target = GO_SHORTCUTS.get(event.key.toLowerCase());
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        openHref(router, target.scope === "security" ? target.href(lastSymbol) : target.href(undefined, { lastSector }));
      }
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      openCommand();
    } else if (event.key === "?") {
      event.preventDefault();
      openShortcuts();
    } else if (event.key === "g" || event.key === "G") {
      event.preventDefault();
      window.clearTimeout(goTimer.current);
      setGoPending(true);
      goTimer.current = window.setTimeout(() => setGoPending(false), GO_TIMEOUT_MS);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener, true);
    return () => {
      document.removeEventListener("keydown", listener, true);
      window.clearTimeout(goTimer.current);
    };
  }, []);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-xs focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        {t.shell.skipToContent}
      </a>
      <TopBar />
      <TickerStrip />
      <div className="flex min-h-0 flex-1">
        <NavRail groups={groups} />
        <main id="main" tabIndex={-1} className="relative min-w-0 flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] focus:outline-none md:pb-0">
          {children}
        </main>
      </div>
      <StatusBar goPending={goPending} dataSource={dataSource} />
      <MobileTabBar ctx={ctx} />
      <CommandPalette />
      <ShortcutsSheet />
      <ChatDrawer />
      <NewsDrawer />
      <AlertEngine />
      <PositionEditorHost />
      <AlertEditorHost />
      {/* Reads the search parameters, so it waits in a boundary of its own instead of opting the shell out of static rendering. */}
      <Suspense fallback={null}>
        <HashLanding />
      </Suspense>
    </div>
  );
}
