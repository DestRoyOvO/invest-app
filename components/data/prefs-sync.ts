// Restored display preferences, applied through the setters of the preferences provider (PrefsProvider), which write
// the cookies and the <html> attributes and keep the theme-color meta and the resolved theme in step, exactly as the
// settings menu does. Pure, so it is unit tested with fake setters; usePrefsSync in hooks.ts binds it to the provider.

import type { PrefCookies } from "@/lib/backup";
import { DENSITIES, THEMES, UPDOWNS, type Density, type Prefs, type Theme, type UpDown } from "@/lib/prefs";
import type { Lang } from "@/types/api";

export interface PrefSetters {
  setLang(lang: Lang): void;
  setTheme(theme: Theme): void;
  setUpdown(updown: UpDown): void;
  setDensity(density: Density): void;
}

const LANGS: readonly Lang[] = ["en", "zh"];

function isOneOf<T extends string>(value: string | undefined, options: readonly T[]): value is T {
  return value !== undefined && (options as readonly string[]).includes(value);
}

/** Applies preference cookies from a backup (or an undo); missing values and values this version cannot show are skipped. */
export function applyPrefCookies(cookies: PrefCookies, setters: PrefSetters): void {
  // Language first: switching it rewrites the color cookie with the convention on screen, which the backup's own
  // convention, when it has one, then replaces.
  if (isOneOf(cookies.is_lang, LANGS)) setters.setLang(cookies.is_lang);
  if (isOneOf(cookies.is_theme, THEMES)) setters.setTheme(cookies.is_theme);
  if (isOneOf(cookies.is_updown, UPDOWNS)) setters.setUpdown(cookies.is_updown);
  if (isOneOf(cookies.is_density, DENSITIES)) setters.setDensity(cookies.is_density);
}

/** The preferences on screen, as backup cookies: what a restore compares with and what its undo puts back. */
export function prefCookiesOf(prefs: Prefs): Required<PrefCookies> {
  return { is_lang: prefs.lang, is_theme: prefs.theme, is_updown: prefs.updown, is_density: prefs.density };
}
