"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";

import { ChatDrawer } from "@/components/ai/ChatDrawer";
import { AlertEngine } from "@/components/alerts/AlertEngine";
import { NewsDrawer } from "@/components/news/NewsDrawer";
import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { useLastSymbol } from "@/hooks/useLastSymbol";
import { stockPath } from "@/lib/api-client";

import { CommandPalette } from "./CommandPalette";
import { MobileTabBar } from "./MobileTabBar";
import { navItems } from "./nav";
import { NavRail } from "./NavRail";
import { StatusBar } from "./StatusBar";
import { TickerStrip } from "./TickerStrip";
import { TopBar } from "./TopBar";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function TerminalShell({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const { openCommand, commandOpen } = useUi();
  const lastSymbol = useLastSymbol();
  const items = useMemo(() => navItems(stockPath(lastSymbol)), [lastSymbol]);

  // Keyboard: "/" or Ctrl/Cmd+K opens the command bar; "g" then a letter jumps to a section.
  useEffect(() => {
    let gPressedAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      // Shortcuts never act behind an open dialog (palette, drawers, position editor).
      if (event.defaultPrevented || commandOpen || document.querySelector("[aria-modal=\"true\"]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommand();
        return;
      }
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        openCommand();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "g") {
        gPressedAt = Date.now();
        return;
      }
      if (gPressedAt && Date.now() - gPressedAt < 1200) {
        const target = items.find((item) => item.shortcut === key);
        if (target) {
          event.preventDefault();
          router.push(target.href);
        }
      }
      gPressedAt = 0;
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commandOpen, items, openCommand, router]);

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
        <NavRail items={items} />
        <main id="main" tabIndex={-1} className="relative min-w-0 flex-1 overflow-y-auto pb-14 focus:outline-none md:pb-0">
          {children}
        </main>
      </div>
      <StatusBar />
      <MobileTabBar items={items} />
      <CommandPalette />
      <ChatDrawer />
      <NewsDrawer />
      <AlertEngine />
    </div>
  );
}
