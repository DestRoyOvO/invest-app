import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultRestoreMode, storeName, type StoreDiff } from "@/lib/backup";
import { MESSAGES } from "@/lib/i18n/messages";

import { diffSummary, formatShares, lastBackupLabel, messagesFor, prefNameLabel, prefValueLabel, storeLabel, symbolList } from "./labels";

const en = MESSAGES.en;
const zh = MESSAGES.zh;

function diff(added: string[], changed: string[], removed: string[]): StoreDiff {
  return { key: "investseek:x:v1", kind: "other", added, changed, removed, invalid: 0, rejected: false, keptLocal: [], overflow: [] };
}

/** Keys written before the naming rule (investseek:<name>:v1) and still in use. */
const UNVERSIONED_KEYS = ["investseek:last-symbol"];

/**
 * Every storage key in the app's source: the versioned "investseek:<name>:vN" literals (createLocalStore keys and the
 * strings kept with useLocalString) and the unversioned keys above. Unversioned names such as the alert engine's lock
 * are not storage. The backup bookkeeping key is built from STORAGE_PREFIX and never listed.
 */
function storageKeysInSource(): string[] {
  const keys = new Set<string>(UNVERSIONED_KEYS);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        for (const match of readFileSync(path, "utf8").matchAll(/["'`](investseek:[a-z0-9-]+:v\d+)["'`]/g)) keys.add(match[1]);
      }
    }
  };
  for (const root of ["app", "components", "hooks", "lib"]) walk(join(process.cwd(), root));
  return [...keys].sort();
}

describe("data labels", () => {
  it("names known stores and leaves others unnamed, ignoring inherited keys", () => {
    expect(storeLabel(en, "investseek:holdings:v1")).toBe("Positions");
    expect(storeLabel(zh, "investseek:alert-log:v1")).toBe("提醒记录");
    expect(storeLabel(en, "investseek:last-symbol")).toBe("Last viewed symbol");
    expect(storeLabel(en, "investseek:ai-chats:v1")).toBe("Assistant chats");
    expect(storeLabel(zh, "investseek:last-sector:v1")).toBe("上次查看的板块");
    expect(storeLabel(en, "investseek:mystery:v2")).toBeNull();
    expect(storeLabel(en, "investseek:constructor:v1")).toBeNull();
  });

  it("names every key the app stores, in both languages, and nothing it no longer stores", () => {
    const keys = storageKeysInSource();
    // The stores of every feature: a regex that silently matched nothing would pass the checks below.
    for (const key of ["investseek:watchlist:v1", "investseek:screens:v1", "investseek:ai-chats:v1", "investseek:movers:v1", "investseek:last-symbol"]) {
      expect(keys).toContain(key);
    }
    for (const key of keys) {
      expect(storeLabel(en, key), key).not.toBeNull();
      expect(storeLabel(zh, key), key).not.toBeNull();
    }
    // Display settings are the preference cookies, not a storage key.
    const names = new Set(keys.map(storeName));
    for (const name of Object.keys(en.data.stores).filter((name) => name !== "prefs")) expect(names.has(name), name).toBe(true);
  });

  it("counts only browsing history as nothing to lose when offering Replace first", () => {
    const history = { "investseek:last-symbol": "NVDA", "investseek:recents:v1": '["NVDA"]', "investseek:last-sector:v1": '"energy"' };
    expect(defaultRestoreMode(history)).toBe("replace");
    // View settings are choices the reader made: a restore merges into them.
    for (const key of ["investseek:port:v1", "investseek:calendar:v1", "investseek:movers:v1", "investseek:ai:v1"]) {
      expect(defaultRestoreMode({ ...history, [key]: "{}" }), key).toBe("merge");
    }
  });

  it("says when the last backup was", () => {
    expect(lastBackupLabel(en, null)).toBe("No backup yet");
    expect(lastBackupLabel(en, 0)).toBe("Last backup today");
    expect(lastBackupLabel(en, 1)).toBe("Last backup yesterday");
    expect(lastBackupLabel(en, 12)).toBe("Last backup 12 days ago");
    expect(lastBackupLabel(zh, 12)).toBe("上次备份在 12 天前");
  });

  it("puts preference values into words", () => {
    expect(prefNameLabel(en, "is_updown")).toBe("Price colors");
    expect(prefValueLabel(en, "cn")).toBe("Red up");
    expect(prefValueLabel(zh, "light")).toBe("浅色");
    expect(prefValueLabel(en, "neon")).toBe("neon");
    expect(prefValueLabel(en, "constructor")).toBe("constructor");
    expect(prefValueLabel(en, null)).toBe("—");
  });

  it("picks the messages of a restored language", () => {
    expect(messagesFor("zh", en)).toBe(zh);
    expect(messagesFor("en", zh)).toBe(en);
    expect(messagesFor("fr", zh)).toBe(zh);
    expect(messagesFor(undefined, en)).toBe(en);
  });

  it("sums store diffs", () => {
    expect(diffSummary(en, [diff(["A", "B"], [], ["C"]), diff(["D"], ["E"], [])])).toBe("3 added, 1 changed, 1 removed");
    expect(diffSummary(zh, [])).toBe("新增 0 项，修改 0 项，移除 0 项");
  });

  it("formats share counts and symbol lists", () => {
    expect(formatShares(25, "en")).toBe("25");
    expect(formatShares(3.5, "en")).toBe("3.5");
    expect(formatShares(1234.125, "zh")).toBe("1,234.125");
    expect(formatShares(-5, "en")).toBe("−5");
    expect(symbolList(["A", "B"])).toBe("A, B");
    expect(symbolList(["A", "B", "C", "D"], 2)).toBe("A, B +2");
  });
});
