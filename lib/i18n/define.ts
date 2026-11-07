// Helpers for typed UI dictionaries. Feature namespaces live in their own files (lib/i18n/<feature>.ts) and are
// mounted in lib/i18n/messages.ts, so features can add strings without editing one shared file.

/** Turns the literal string types of an `as const` dictionary into plain strings, keeping the key structure. */
export type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/**
 * Declares one namespace in both languages. `zh` must have exactly the keys of `en` (missing or extra keys fail type
 * checking); use {name} placeholders with tpl() from lib/format.ts.
 */
export function defineMessages<const E>(en: E, zh: Widen<E>): { en: E; zh: Widen<E> } {
  return { en, zh };
}
