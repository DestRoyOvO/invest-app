"use client";

import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { cn } from "@/lib/cn";
import { isFunctionActive, shortcutKeys } from "@/lib/functions";

import type { NavGroup } from "./nav";

// Every item and the assistant have to fit between the ticker strip and the status bar (106px of chrome). Tablets
// stack the icon over the code in 40px rows; wide screens add labels and group headings in 32px rows. On viewports up
// to 704px tall (a 1366x768 laptop window leaves about 550px for the rail) tablets put the code beside the icon in 32px
// rows and wide screens use 28px rows with tighter headings. Shorter windows scroll, with the assistant kept in view:
// wide screens show a thin scrollbar; tablets hide it, because in a 64px rail it would cut off the codes.
const rowClass = cn(
  "relative flex h-10 w-full flex-col items-center justify-center gap-1 text-fg-2 transition-colors hover:bg-hover hover:text-fg",
  "max-xl:[@media(max-height:44rem)]:h-8 max-xl:[@media(max-height:44rem)]:flex-row max-xl:[@media(max-height:44rem)]:justify-start max-xl:[@media(max-height:44rem)]:gap-1.5 max-xl:[@media(max-height:44rem)]:px-2.5",
  "xl:h-8 xl:flex-row xl:justify-start xl:gap-3 xl:px-4 xl:[@media(max-height:44rem)]:h-7",
);
const headingClass = "sr-only xl:not-sr-only xl:block xl:px-4 xl:pt-2.5 xl:pb-1 xl:leading-4 xl:[@media(max-height:44rem)]:pt-1.5 xl:[@media(max-height:44rem)]:pb-0.5";
const listClass = "py-1 max-xl:[@media(max-height:44rem)]:py-0.5 xl:py-0";
const codeClass = "mono text-[0.6875rem] leading-none tracking-[0.04em]";

/**
 * Left navigation from the function registry, in four groups. Tablets show each function's icon with its code; wide
 * screens add group headings and labels, with the code on the right. The active item gets an accent bar.
 */
export function NavRail({ groups }: { groups: NavGroup[] }) {
  const t = useT();
  const pathname = usePathname();
  const { openChat } = useUi();
  const baseId = useId();

  return (
    <nav
      aria-label={t.nav.primary}
      className="hidden w-16 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel max-xl:[scrollbar-width:none] md:flex xl:w-52 max-xl:[&::-webkit-scrollbar]:hidden"
    >
      {groups.map(({ group, items }, index) => {
        const headingId = `${baseId}-${group}`;
        return (
          <div key={group} className={cn(index > 0 && "border-t border-line xl:border-t-0")}>
            <div id={headingId} className={headingClass}>
              <span className="col-head">{t.nav.groups[group]}</span>
            </div>
            <ul aria-labelledby={headingId} className={listClass}>
              {items.map(({ fn, href, icon: Icon }) => {
                const active = isFunctionActive(fn, pathname);
                const label = t.help.functions[fn.labelKey].label;
                const keys = shortcutKeys(fn.shortcut).join(" ");
                return (
                  <li key={fn.labelKey}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      title={[label, fn.code, keys].filter(Boolean).join(" · ")}
                      className={cn(rowClass, active && "bg-hover text-fg")}
                    >
                      {active ? <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 bg-accent" /> : null}
                      <Icon aria-hidden className={cn("size-4 shrink-0", active && "text-accent")} strokeWidth={1.75} />
                      <span className="sr-only xl:not-sr-only xl:min-w-0 xl:flex-1 xl:truncate xl:text-sm">{label}</span>
                      <span className={cn(codeClass, active ? "text-fg-2" : "text-fg-3")}>{fn.code}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* Sticky, so the assistant stays in view when a short window makes the rail scroll. */}
      <div className="sticky bottom-0 mt-auto shrink-0 border-t border-line bg-panel">
        <button type="button" onClick={() => openChat()} title={t.nav.assistant} className={rowClass}>
          <MessageSquareText aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="sr-only xl:not-sr-only xl:flex-1 xl:text-left xl:text-sm">{t.nav.assistant}</span>
          <span className={cn(codeClass, "text-fg-3")}>AI</span>
        </button>
      </div>
    </nav>
  );
}
