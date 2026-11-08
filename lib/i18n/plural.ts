// Counts in messages. English has two plural forms, which Intl.PluralRules("en") calls one (1 position) and other
// (0, 2 or 1.5 positions); Chinese has none. So a message that counts something is an English pair whose Chinese side
// keeps its one string: Widen (./define.ts) types every { one, other } pair of the dictionaries as CountMessage, which
// tpl() does not accept, so each call site goes through plural().

import { tpl } from "@/lib/format";

/** An English count message in its two forms: { one: "{n} position", other: "{n} positions" }. */
export interface PluralForms {
  /** Exactly one. */
  one: string;
  /** Every other count: zero, two and more, fractions. */
  other: string;
}

/** A message that counts something: the English pair, or the one string of a language without plural forms. */
export type CountMessage = string | PluralForms;

const english = new Intl.PluralRules("en-US");

/** The form of `message` for `count`, placeholders unfilled. */
export function pluralForm(message: CountMessage, count: number): string {
  if (typeof message === "string") return message;
  return english.select(count) === "one" ? message.one : message.other;
}

/**
 * The message for `count` with its placeholders filled. {n} is the count unless `values` gives it in another form (a
 * formatted number of shares, say); a message that counts with another placeholder ({m}, {rows}) takes it from `values`.
 */
export function plural(message: CountMessage, count: number, values: Record<string, string | number> = {}): string {
  return tpl(pluralForm(message, count), { n: count, ...values });
}
