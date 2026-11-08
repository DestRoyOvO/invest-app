"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";

import type { QuoteTab } from "./quote-utils";

interface QuoteTabsProps {
  tabs: readonly QuoteTab[];
  active: QuoteTab;
  hrefFor: (tab: QuoteTab) => string;
}

/**
 * Section tabs under the quote header. Each is a link to ?tab=..., so a tab can be bookmarked, opened in a new tab
 * and left with Back; the current one carries aria-current. The row scrolls sideways on narrow screens, and brings
 * the current tab into view (a deep link to Ownership on a phone).
 */
export function QuoteTabs({ tabs, active, hrefFor }: QuoteTabsProps) {
  const { t } = usePrefs();
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const link = activeRef.current;
    if (!list || !link) return;
    // Sideways only: scrollIntoView could also scroll the page.
    const listBox = list.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    if (linkBox.left < listBox.left) list.scrollLeft -= listBox.left - linkBox.left + 8;
    else if (linkBox.right > listBox.right) list.scrollLeft += linkBox.right - listBox.right + 8;
  }, [active, tabs.length]);

  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t.stock.tabs.label} className="bg-panel">
      <ul ref={listRef} className="no-scrollbar flex overflow-x-auto px-2">
        {tabs.map((tab) => {
          const current = tab === active;
          return (
            <li key={tab} className="shrink-0">
              <Link
                ref={current ? activeRef : undefined}
                href={hrefFor(tab)}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center border-b-2 px-3 text-xs font-medium tracking-[0.04em] whitespace-nowrap uppercase transition-colors focus-visible:outline-offset-[-2px]",
                  current ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
                )}
              >
                {t.stock.tabs[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
