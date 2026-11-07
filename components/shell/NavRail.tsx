"use client";

import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { cn } from "@/lib/cn";

import type { NavItem } from "./nav";

/** Left navigation: icons on tablets, icons with labels and shortcuts on wide screens. */
export function NavRail({ items }: { items: NavItem[] }) {
  const t = useT();
  const pathname = usePathname();
  const { openChat } = useUi();

  return (
    <nav aria-label={t.nav.primary} className="hidden w-14 shrink-0 flex-col border-r border-line bg-panel py-2 md:flex xl:w-48">
      {items.map((item) => {
        const active = item.isActive(pathname);
        const Icon = item.icon;
        const label = item.label(t);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "relative flex h-10 items-center gap-3 px-[1.15rem] text-sm transition-colors xl:px-4",
              active ? "bg-hover text-fg" : "text-fg-2 hover:bg-hover hover:text-fg",
            )}
          >
            {active ? <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 bg-accent" /> : null}
            <Icon aria-hidden className={cn("size-4 shrink-0", active && "text-accent")} strokeWidth={1.75} />
            <span className="sr-only xl:not-sr-only">{label}</span>
            <span aria-hidden className="num ml-auto hidden text-xs text-fg-3 xl:inline">
              G {item.shortcut.toUpperCase()}
            </span>
          </Link>
        );
      })}

      <div className="mt-auto border-t border-line pt-2">
        <button
          type="button"
          onClick={() => openChat()}
          title={t.nav.assistant}
          className="flex h-10 w-full items-center gap-3 px-[1.15rem] text-sm text-fg-2 transition-colors hover:bg-hover hover:text-fg xl:px-4"
        >
          <MessageSquareText aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="sr-only xl:not-sr-only">{t.nav.assistant}</span>
        </button>
      </div>
    </nav>
  );
}
