// Display helpers shared by the data screens.

import { storeName, type PrefCookieName, type StoreDiff } from "@/lib/backup";
import { DASH, tpl } from "@/lib/format";
import { MESSAGES, type Messages } from "@/lib/i18n/messages";
import type { Lang } from "@/types/api";

/**
 * The messages of a language a restore switches to ("en" or "zh"), or `fallback` for anything else: a toast built
 * right after a restore would otherwise speak the language the page is leaving.
 */
export function messagesFor(lang: string | null | undefined, fallback: Messages): Messages {
  return lang === "en" || lang === "zh" ? MESSAGES[lang] : fallback;
}

/** The friendly name of a stored key ("Watchlist"), or null for keys this app version does not know. */
export function storeLabel(t: Messages, key: string): string | null {
  return own(t.data.stores, storeName(key));
}

/** A dictionary entry, ignoring inherited properties such as "constructor". */
function own(dictionary: object, key: string): string | null {
  const value: unknown = Object.prototype.hasOwnProperty.call(dictionary, key) ? (dictionary as Record<string, unknown>)[key] : null;
  return typeof value === "string" ? value : null;
}

/** "Last backup 3 days ago", "Last backup today" or "No backup yet". */
export function lastBackupLabel(t: Messages, days: number | null): string {
  if (days === null) return t.data.lastBackup.never;
  if (days === 0) return t.data.lastBackup.today;
  if (days === 1) return t.data.lastBackup.yesterday;
  return tpl(t.data.lastBackup.days, { n: days });
}

/** A preference value in words ("Dark", "Red up"); unknown values are shown as they are. */
export function prefValueLabel(t: Messages, value: string | null): string {
  if (value === null) return DASH;
  return own(t.data.prefs.values, value) ?? value;
}

export function prefNameLabel(t: Messages, name: PrefCookieName): string {
  return t.data.prefs.names[name];
}

/** "2 added, 1 changed, 0 removed" over several store diffs. */
export function diffSummary(t: Messages, diffs: readonly StoreDiff[]): string {
  const sum = (pick: (diff: StoreDiff) => number) => diffs.reduce((total, diff) => total + pick(diff), 0);
  return tpl(t.data.backup.summary, { added: sum((d) => d.added.length), changed: sum((d) => d.changed.length), removed: sum((d) => d.removed.length) });
}

const shareFormats = new Map<Lang, Intl.NumberFormat>();

/** Share counts keep their fractions (fractional shares) without padding: 25, 3.5, 0.125. */
export function formatShares(value: number, lang: Lang): string {
  let format = shareFormats.get(lang);
  if (!format) {
    format = new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 6 });
    shareFormats.set(lang, format);
  }
  return format.format(value);
}

/** A list of symbols for a sentence, cut after `max` with a count of the rest. */
export function symbolList(symbols: readonly string[], max = 8): string {
  return symbols.length > max ? `${symbols.slice(0, max).join(", ")} +${symbols.length - max}` : symbols.join(", ");
}
