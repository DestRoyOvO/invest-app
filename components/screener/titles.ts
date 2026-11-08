// Page titles for /screener. Page titles are English throughout the app (app/layout.tsx appends " · InvestSeek"), so
// these read the English messages whatever the interface language. page.tsx sets the title from the URL on load and
// ScreenerView keeps it in step when the tab changes on the client.

import { MESSAGES } from "@/lib/i18n/messages";
import type { ScreenerViewTab } from "@/lib/screens";

const SEPARATOR = " · ";

/** "Screener" or "Discover": the page part of the title. */
export function screenerTitle(tab: ScreenerViewTab): string {
  return tab === "discover" ? MESSAGES.en.discover.title : MESSAGES.en.screener.title;
}

/** The document title for a tab: the page part replaced, the site suffix the title template added kept. */
export function screenerPageTitle(tab: ScreenerViewTab, current: string): string {
  const at = current.lastIndexOf(SEPARATOR);
  return at >= 0 ? `${screenerTitle(tab)}${current.slice(at)}` : screenerTitle(tab);
}
