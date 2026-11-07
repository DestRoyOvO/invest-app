"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { MESSAGES, type Messages } from "@/lib/i18n/messages";
import { htmlLang, PREF_COOKIE_MAX_AGE, PREF_COOKIES, type Prefs, type Theme, type UpDown } from "@/lib/prefs";
import type { Lang } from "@/types/api";

interface PrefsContextValue extends Prefs {
  t: Messages;
  setLang: (lang: Lang) => void;
  setTheme: (theme: Theme) => void;
  setUpdown: (updown: UpDown) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function PrefsProvider({ initial, children }: { initial: Prefs; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);

  const update = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((current) => ({ ...current, [key]: value }));
    writeCookie(PREF_COOKIES[key], value);
    const root = document.documentElement;
    if (key === "lang") root.lang = htmlLang(value as Lang);
    if (key === "theme") root.dataset.theme = value as Theme;
    if (key === "updown") root.dataset.updown = value as UpDown;
  }, []);

  const value = useMemo<PrefsContextValue>(
    () => ({
      ...prefs,
      t: MESSAGES[prefs.lang],
      setLang: (lang) => {
        update("lang", lang);
        // Keep the color convention on screen: without its own cookie it would follow the new language after a reload.
        update("updown", prefs.updown);
      },
      setTheme: (theme) => update("theme", theme),
      setUpdown: (updown) => update("updown", updown),
    }),
    [prefs, update],
  );

  return <PrefsContext value={value}>{children}</PrefsContext>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside PrefsProvider");
  return ctx;
}

/** Shorthand for the current language's messages. */
export function useT(): Messages {
  return usePrefs().t;
}
