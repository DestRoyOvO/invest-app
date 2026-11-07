// Freshness wording for the status bar. Pure, so it is unit tested.

import { staleSinceLabel } from "@/components/ui/stale";
import { tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import type { Lang } from "@/types/api";
import type { BoardResponse } from "@/types/shell";

import { ET_TIME_ZONE } from "./session";

/** "13:05 ET" for a time today in New York, "Nov 6 16:00 ET" for an older day ("美东 13:05" in Chinese). */
export function etLabel(t: Messages, iso: string, lang: Lang, now: number | null): string {
  return tpl(t.shell.et, { time: staleSinceLabel(iso, lang, now ?? Date.parse(iso), ET_TIME_ZONE) });
}

/** True when the board shows older quotes because Yahoo failed (stale quotes or the quotes_stale warning). */
export function boardIsStale(board: BoardResponse): boolean {
  return board.warnings.includes("quotes_stale") || board.board.some((item) => item.quote.stale);
}

/**
 * "Quotes delayed since 13:05 ET · Yahoo unavailable" when older quotes are on screen: the server served stale quotes,
 * or the latest board request failed and the previous board is still shown. Null while quotes are live.
 */
export function delayedNotice(t: Messages, board: BoardResponse | undefined, requestFailed: boolean, lang: Lang, now: number | null): string | null {
  if (!board) return null;
  if (!boardIsStale(board) && !requestFailed) return null;
  const since = board.quotesAsOf ?? (requestFailed ? board.asOf : null);
  return since ? tpl(t.shell.quotesDelayed, { time: etLabel(t, since, lang, now) }) : t.shell.quotesDelayedUnknown;
}
