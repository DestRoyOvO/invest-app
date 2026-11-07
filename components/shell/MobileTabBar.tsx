"use client";

import { Ellipsis, MessageSquareText, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { cn } from "@/lib/cn";
import { isFunctionActive } from "@/lib/functions";

import { MoreSheet } from "./MoreSheet";
import { navItem, type NavContext } from "./nav";

const tabClass = "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs leading-none";

/** Bottom tab bar for phones (below md): Market, Watchlist, Search, Assistant and More (every function in a sheet). */
export function MobileTabBar({ ctx }: { ctx: NavContext }) {
  const t = useT();
  const pathname = usePathname();
  const { openCommand, openChat } = useUi();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = [
    { item: navItem("mkt", ctx), label: t.nav.market },
    { item: navItem("wl", ctx), label: t.nav.watchlist },
  ];

  return (
    <>
      <nav
        aria-label={t.nav.primary}
        className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {tabs.map(({ item, label }) => {
          const active = isFunctionActive(item.fn, pathname);
          const Icon = item.icon;
          return (
            <Link key={item.fn.labelKey} href={item.href} aria-current={active ? "page" : undefined} className={cn(tabClass, active ? "text-accent" : "text-fg-2")}>
              <Icon aria-hidden className="size-5" strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
        <button type="button" onClick={openCommand} aria-haspopup="dialog" className={cn(tabClass, "text-fg-2")}>
          <Search aria-hidden className="size-5" strokeWidth={1.75} />
          {t.nav.search}
        </button>
        <button type="button" onClick={() => openChat()} aria-haspopup="dialog" className={cn(tabClass, "text-fg-2")}>
          <MessageSquareText aria-hidden className="size-5" strokeWidth={1.75} />
          {t.nav.assistant}
        </button>
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen} className={cn(tabClass, "text-fg-2")}>
          <Ellipsis aria-hidden className="size-5" strokeWidth={1.75} />
          {t.nav.more}
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} ctx={ctx} />
    </>
  );
}
