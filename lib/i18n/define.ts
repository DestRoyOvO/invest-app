// Helpers for typed UI dictionaries. Feature namespaces live in their own files (lib/i18n/<feature>.ts) and are
// mounted in lib/i18n/messages.ts, so features can add strings without editing one shared file.

import type { CountMessage, PluralForms } from "./plural";

/** True for an English count pair: an object with exactly the keys `one` and `other` (lib/i18n/plural.ts). */
type IsPluralForms<T> = T extends PluralForms ? ([Exclude<keyof T, keyof PluralForms>] extends [never] ? true : false) : false;

/**
 * Turns the literal string types of an `as const` dictionary into plain strings, keeping the key structure. An English
 * count pair ({ one, other }) becomes a CountMessage, so a language without plural forms keeps one string there and
 * every reader goes through plural().
 */
export type Widen<T> = { [K in keyof T]: T[K] extends string ? string : IsPluralForms<T[K]> extends true ? CountMessage : Widen<T[K]> };

/**
 * Declares one namespace in both languages. `zh` must have exactly the keys of `en` (missing or extra keys fail type
 * checking); use {name} placeholders with tpl() from lib/format.ts, and plural() from lib/i18n/plural.ts for counts.
 */
export function defineMessages<const E>(en: E, zh: Widen<E>): { en: E; zh: Widen<E> } {
  return { en, zh };
}
