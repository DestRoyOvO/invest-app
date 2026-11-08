// Page titles for /screener in the reader's language (app/layout.tsx appends " · InvestSeek"). page.tsx sets the title
// from the URL on load and ScreenerView keeps it in step when the tab or the language changes on the client.

import { MESSAGES } from "@/lib/i18n/messages";
import type { ScreenerViewTab } from "@/lib/screens";
import type { Lang } from "@/types/api";

const SEPARATOR = " · ";

/** "Screener" or "Discover" ("选股器", "全市场"): the page part of the title. */
export function screenerTitle(tab: ScreenerViewTab, lang: Lang): string {
  const t = MESSAGES[lang];
  return tab === "discover" ? t.discover.title : t.screener.title;
}

/** The document title for a tab: the page part replaced, the site suffix the title template added kept. */
export function screenerPageTitle(tab: ScreenerViewTab, lang: Lang, current: string): string {
  const at = current.lastIndexOf(SEPARATOR);
  return at >= 0 ? `${screenerTitle(tab, lang)}${current.slice(at)}` : screenerTitle(tab, lang);
}
