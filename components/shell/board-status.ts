// Freshness wording for the status bar and the ticker strip. Pure, so it is unit tested.

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

export interface BoardNotice {
  /** delayed: older quotes are on screen; unavailable: no board has loaded at all. */
  kind: "delayed" | "unavailable";
  /** For the status bar and the live region: "Quotes delayed since 13:05 ET · Yahoo unavailable". */
  text: string;
  /** For the phone ticker strip, which has no status bar: "Delayed since 13:05 ET". */
  short: string;
}

/**
 * What the shell says about the board quotes; null while they are live or the first board is still loading.
 * Delayed: the server served stale quotes, or the latest board request failed and the previous board is still shown.
 * Unavailable: the board request failed before any board arrived.
 */
export function boardNotice(t: Messages, board: BoardResponse | undefined, requestFailed: boolean, lang: Lang, now: number | null): BoardNotice | null {
  if (!board) return requestFailed ? { kind: "unavailable", text: t.shell.quotesUnavailable, short: t.shell.quotesUnavailable } : null;
  if (!boardIsStale(board) && !requestFailed) return null;
  const since = board.quotesAsOf ?? (requestFailed ? board.asOf : null);
  if (!since) return { kind: "delayed", text: t.shell.quotesDelayedUnknown, short: t.shell.quotesDelayedUnknown };
  const time = etLabel(t, since, lang, now);
  return { kind: "delayed", text: tpl(t.shell.quotesDelayed, { time }), short: tpl(t.shell.delayedSince, { time }) };
}
