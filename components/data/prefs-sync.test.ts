import { describe, expect, it } from "vitest";

import { applyBackup, createBackup, prefChanges, serializeBackup, validateBackup, type BackupEnv, type PrefCookieName, type PrefCookies, type StorageLike } from "@/lib/backup";

import { applyPrefCookies, prefCookiesOf, type PrefSetters } from "./prefs-sync";

function recorder() {
  const calls: string[] = [];
  const setters: PrefSetters = {
    setLang: (value) => calls.push(`lang=${value}`),
    setTheme: (value) => calls.push(`theme=${value}`),
    setUpdown: (value) => calls.push(`updown=${value}`),
    setDensity: (value) => calls.push(`density=${value}`),
  };
  return { calls, setters };
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("restored display preferences", () => {
  it("applies a backup's light theme, color-blind colors and compact density through the provider", async () => {
    // The file a backup from another browser produces, read and restored the way BackupPanel does it.
    const file = serializeBackup(createBackup({}, { is_theme: "light", is_updown: "cb", is_density: "compact" }, new Date("2026-11-07T12:00:00Z")));
    const parsed = await validateBackup(file);
    if (!parsed.ok) throw new Error(parsed.error);
    const jar: PrefCookies = { is_lang: "en", is_theme: "dark", is_updown: "intl" };
    const env: BackupEnv = {
      storage: memoryStorage(),
      readCookies: () => ({ ...jar }),
      writeCookie: (name: PrefCookieName, value: string) => {
        jar[name] = value;
      },
      notify: () => {},
      stores: new Map(),
    };
    const result = applyBackup(parsed.backup, "merge", env, { prefs: true });
    expect(result.cookies.map((change) => change.name)).toEqual(["is_theme", "is_updown", "is_density"]);

    const { calls, setters } = recorder();
    applyPrefCookies(Object.fromEntries(result.cookies.map((change) => [change.name, change.newValue])), setters);
    expect(calls).toEqual(["theme=light", "updown=cb", "density=compact"]);
  });

  it("switches the language before the colors, so a restored convention is not overwritten", () => {
    const { calls, setters } = recorder();
    applyPrefCookies({ is_updown: "cn", is_lang: "zh", is_density: "comfortable", is_theme: "system" }, setters);
    expect(calls).toEqual(["lang=zh", "theme=system", "updown=cn", "density=comfortable"]);
  });

  it("skips missing values and values this version cannot show", () => {
    const { calls, setters } = recorder();
    applyPrefCookies({ is_lang: "fr", is_theme: "sepia", is_updown: "cb", is_density: "tiny" }, setters);
    expect(calls).toEqual(["updown=cb"]);
    applyPrefCookies({}, setters);
    expect(calls).toEqual(["updown=cb"]);
  });

  it("previews only the preference changes it can apply", async () => {
    const parsed = await validateBackup(serializeBackup(createBackup({}, { is_theme: "sepia", is_updown: "cb", is_density: "compact" })));
    if (!parsed.ok) throw new Error(parsed.error);
    const onScreen = prefCookiesOf({ lang: "en", theme: "dark", updown: "intl", density: "comfortable" });
    expect(prefChanges(parsed.backup, onScreen)).toEqual([
      { name: "is_updown", from: "intl", to: "cb" },
      { name: "is_density", from: "comfortable", to: "compact" },
    ]);
  });

  it("reads the preferences on screen as backup cookies", () => {
    expect(prefCookiesOf({ lang: "zh", theme: "system", updown: "cn", density: "compact" })).toEqual({ is_lang: "zh", is_theme: "system", is_updown: "cn", is_density: "compact" });
  });
});
