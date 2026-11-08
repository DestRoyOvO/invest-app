"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { MESSAGES, type Messages } from "@/lib/i18n/messages";
import { htmlLang, prefCookie, themeColorMetas, type Density, type Prefs, type Theme, type UpDown } from "@/lib/prefs";
import type { Lang } from "@/types/api";

interface PrefsContextValue extends Prefs {
  t: Messages;
  /** The theme on screen: System resolved through prefers-color-scheme (dark during server rendering). */
  resolvedTheme: "dark" | "light";
  setLang: (lang: Lang) => void;
  setTheme: (theme: Theme) => void;
  setUpdown: (updown: UpDown) => void;
  setDensity: (density: Density) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

const DARK_SCHEME = "(prefers-color-scheme: dark)";

function subscribeScheme(listener: () => void): () => void {
  const query = window.matchMedia(DARK_SCHEME);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/**
 * Points the theme-color meta tags at the theme on screen. Next renders them for the theme in the cookie (one tag, or
 * one per color scheme for System) and React owns them, so they are only updated in place, never added or removed:
 * the next navigation renders them afresh from the new cookie. Until then, System with a single tag shows the color of
 * the scheme in use, and follows it when the scheme changes.
 */
function applyThemeColor(theme: Theme, systemDark: boolean) {
  const metas = Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  const wanted = themeColorMetas(theme);
  const fitted = wanted.length > metas.length ? themeColorMetas(theme === "system" ? (systemDark ? "dark" : "light") : theme) : wanted;
  metas.forEach((meta, i) => {
    const { color, media } = fitted[Math.min(i, fitted.length - 1)];
    meta.content = color;
    if (media) meta.media = media;
    else meta.removeAttribute("media");
  });
}

export function PrefsProvider({ initial, children }: { initial: Prefs; children: ReactNode }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const systemDark = useSyncExternalStore(subscribeScheme, () => window.matchMedia(DARK_SCHEME).matches, () => true);

  useEffect(() => {
    applyThemeColor(prefs.theme, systemDark);
  }, [prefs.theme, systemDark]);

  const update = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((current) => ({ ...current, [key]: value }));
    document.cookie = prefCookie(key, value);
    const root = document.documentElement;
    if (key === "lang") root.lang = htmlLang(value as Lang);
    if (key === "theme") root.dataset.theme = value as Theme;
    if (key === "updown") root.dataset.updown = value as UpDown;
    if (key === "density") root.dataset.density = value as Density;
  }, []);

  const value = useMemo<PrefsContextValue>(
    () => ({
      ...prefs,
      t: MESSAGES[prefs.lang],
      resolvedTheme: prefs.theme === "system" ? (systemDark ? "dark" : "light") : prefs.theme,
      setLang: (lang) => {
        update("lang", lang);
        // Keep the color convention on screen: without its own cookie it would follow the new language after a reload.
        update("updown", prefs.updown);
        // The tab title comes from the server in the cookie's language: render it again in the new one.
        router.refresh();
      },
      setTheme: (theme) => update("theme", theme),
      setUpdown: (updown) => update("updown", updown),
      setDensity: (density) => update("density", density),
    }),
    [prefs, systemDark, update, router],
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
