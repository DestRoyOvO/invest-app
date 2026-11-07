"use client";

import { MessageSquareText, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { cn } from "@/lib/cn";

import type { NavItem } from "./nav";

/** Bottom tab bar for phones (below the md breakpoint). */
export function MobileTabBar({ items }: { items: NavItem[] }) {
  const t = useT();
  const pathname = usePathname();
  const { openCommand, openChat } = useUi();
  const tabClass = "flex flex-1 flex-col items-center justify-center gap-0.5 text-xs leading-none";

  return (
    <nav
      aria-label={t.nav.primary}
      className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items
        .filter((item) => item.key !== "quote")
        .map((item) => {
          const active = item.isActive(pathname);
          const Icon = item.icon;
          return (
            <Link key={item.key} href={item.href} aria-current={active ? "page" : undefined} className={cn(tabClass, active ? "text-accent" : "text-fg-2")}>
              <Icon aria-hidden className="size-5" strokeWidth={1.75} />
              {item.label(t)}
            </Link>
          );
        })}
      <button type="button" onClick={openCommand} className={cn(tabClass, "text-fg-2")}>
        <Search aria-hidden className="size-5" strokeWidth={1.75} />
        {t.nav.search}
      </button>
      <button type="button" onClick={() => openChat()} className={cn(tabClass, "text-fg-2")}>
        <MessageSquareText aria-hidden className="size-5" strokeWidth={1.75} />
        {t.nav.assistant}
      </button>
    </nav>
  );
}
