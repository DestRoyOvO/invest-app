import { describe, expect, it, vi } from "vitest";

import {
  applyBackup,
  applyWrites,
  backupAgeDays,
  backupFileName,
  byteLength,
  clearAllData,
  countEntries,
  createBackup,
  defaultRestoreMode,
  diffHoldings,
  formatBytes,
  hasChanges,
  mergeHoldings,
  mergeNotes,
  mergeWatchlist,
  META_STORAGE_KEY,
  parseBackup,
  planRestore,
  prefChanges,
  readPrefCookies,
  readStorage,
  sanitizeBackupMeta,
  serializeBackup,
  storedItems,
  storeName,
  StorageWriteError,
  undoChanges,
  validateBackup,
  writeAtomically,
  type Backup,
  type BackupEnv,
  type PrefCookieName,
  type PrefCookies,
  type StorageChange,
  type StoreDiff,
  type StoreRegistry,
} from "./backup";
import type { LocalStore } from "./local-store";
import { emptyNote, type SymbolNote } from "./notes";
import { DEFAULT_WATCHLIST } from "./universe";

class MemoryStorage {
  readonly map = new Map<string, string>();
  /** Throws a quota error on this many-th write (1-based); 0 never. */
  failOnWrite = 0;
  writes = 0;

  constructor(entries: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(entries)) this.map.set(key, value);
  }
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes += 1;
    if (this.failOnWrite && this.writes === this.failOnWrite) {
      const error = new Error("The quota has been exceeded.");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  toObject() {
    return Object.fromEntries(this.map);
  }
}

const NOW = new Date("2026-11-07T15:00:00.000Z");
const WL = "investseek:watchlist:v1";
const HOLD = "investseek:holdings:v1";
const NOTES = "investseek:notes:v1";
const ALERTS = "investseek:alerts:v1";

function note(thesis: string, updatedAt: string): SymbolNote {
  return { ...emptyNote(new Date(updatedAt)), thesis };
}

interface Rule {
  id: string;
  symbol: string;
  above: number;
}

/** A registered store with ids, standing in for another package's store (alerts). */
const alertsStore = {
  key: ALERTS,
  sanitize: (raw: unknown) => (Array.isArray(raw) ? raw.filter((r): r is Rule => !!r && typeof r === "object" && typeof (r as Rule).id === "string") : []),
  getServerSnapshot: () => [],
} as unknown as LocalStore<unknown>;
const STORES: StoreRegistry = new Map([[ALERTS, alertsStore]]);

function makeEnv(storage: MemoryStorage, cookies: PrefCookies = {}) {
  const jar: PrefCookies = { ...cookies };
  const notified: StorageChange[][] = [];
  const env: BackupEnv = {
    storage,
    readCookies: () => ({ ...jar }),
    writeCookie: (name: PrefCookieName, value: string) => {
      jar[name] = value;
    },
    notify: (changes) => {
      notified.push([...changes]);
    },
    stores: STORES,
  };
  return { env, jar, notified };
}

function backupOf(storage: Record<string, unknown>, extra: { text?: Record<string, string>; cookies?: PrefCookies } = {}): Backup {
  return {
    app: "investseek",
    schema: 1,
    exportedAt: NOW.toISOString(),
    data: { storage: storage as Backup["data"]["storage"], text: extra.text ?? {}, cookies: extra.cookies ?? {} },
  };
}

function find(diffs: StoreDiff[], key: string): StoreDiff {
  const diff = diffs.find((d) => d.key === key);
  if (!diff) throw new Error(`no diff for ${key}`);
  return diff;
}

describe("reading what is stored", () => {
  it("reads the app's keys only, leaving out the backup bookkeeping unless asked", () => {
    const storage = new MemoryStorage({ [WL]: '["AAPL"]', other: "x", [META_STORAGE_KEY]: "{}", "investseek:last-symbol": "MSFT" });
    expect(readStorage(storage)).toEqual({ [WL]: '["AAPL"]', "investseek:last-symbol": "MSFT" });
    expect(readStorage(storage, { includeMeta: true })).toHaveProperty(META_STORAGE_KEY, "{}");
  });

  it("reads the preference cookies and ignores the rest", () => {
    expect(readPrefCookies("is_lang=zh; session=abc; is_theme=light; is_updown=Red%20up; is_density=compact; is_x=1")).toEqual({ is_lang: "zh", is_theme: "light", is_density: "compact" });
    expect(readPrefCookies("")).toEqual({});
  });
});

describe("createBackup", () => {
  it("splits JSON values from plain text, leaves out the bookkeeping and keeps clean cookies", () => {
    const backup = createBackup(
      { [WL]: '["NVDA","AAPL"]', [HOLD]: '{"AAPL":{"shares":25,"cost":201.3}}', "investseek:last-symbol": "AAPL", [META_STORAGE_KEY]: '{"lastBackupAt":null}' },
      { is_lang: "zh", is_theme: "dark", is_updown: "bad value" },
      NOW,
    );
    expect(backup).toEqual({
      app: "investseek",
      schema: 1,
      exportedAt: "2026-11-07T15:00:00.000Z",
      data: {
        storage: { [HOLD]: { AAPL: { shares: 25, cost: 201.3 } }, [WL]: ["NVDA", "AAPL"] },
        text: { "investseek:last-symbol": "AAPL" },
        cookies: { is_lang: "zh", is_theme: "dark" },
      },
    });
    expect(backupFileName(new Date(2026, 10, 7, 9))).toBe("investseek-backup-2026-11-07.json");
  });

  it("round-trips through the file format and a restore into an empty browser", async () => {
    const original = {
      [WL]: '["MSFT","0700.HK"]',
      [HOLD]: '{"MSFT":{"shares":10,"cost":415}}',
      [NOTES]: JSON.stringify({ MSFT: note("Cloud margins", "2026-11-01T10:00:00.000Z") }),
      [ALERTS]: '[{"id":"a1","symbol":"MSFT","above":500}]',
      "investseek:chart:v1": '{"log":true}',
      "investseek:last-symbol": "MSFT",
    };
    const backup = createBackup(original, { is_lang: "en" }, NOW);
    const parsed = await validateBackup(serializeBackup(backup));
    expect(parsed).toEqual({ ok: true, backup });

    const target = new MemoryStorage();
    const { env, jar } = makeEnv(target);
    applyBackup(backup, "replace", env, { prefs: true });
    expect(readStorage(target)).toEqual(original);
    expect(jar).toEqual({ is_lang: "en" });
  });
});

describe("validateBackup", () => {
  const valid = serializeBackup(backupOf({ [WL]: ["AAPL"] }));

  it("accepts a valid file", async () => {
    expect((await validateBackup(valid)).ok).toBe(true);
  });

  it("names what is wrong with a file", async () => {
    expect(await validateBackup("x".repeat(5 * 1024 * 1024 + 1))).toEqual({ ok: false, error: "too_large" });
    expect(await validateBackup("{not json")).toEqual({ ok: false, error: "not_json" });
    expect(await validateBackup("[1,2]")).toEqual({ ok: false, error: "not_backup" });
    expect(await validateBackup('{"app":"other","schema":1}')).toEqual({ ok: false, error: "not_backup" });
    expect(await validateBackup(valid.replace('"schema": 1', '"schema": 2'))).toEqual({ ok: false, error: "newer_schema" });
    expect(await validateBackup(valid.replace('"schema": 1', '"schema": 0'))).toEqual({ ok: false, error: "invalid" });
    expect(await validateBackup(valid.replace('"exportedAt": "2026-11-07T15:00:00.000Z"', '"exportedAt": "yesterday"'))).toEqual({ ok: false, error: "invalid" });
  });

  it("refuses keys outside the app's prefix and unsafe cookie values", async () => {
    expect((await validateBackup(serializeBackup(backupOf({ "evil:key": 1 })))).ok).toBe(false);
    expect((await validateBackup(serializeBackup(backupOf({}, { cookies: { is_lang: "en; Path=/admin" } })))).ok).toBe(false);
  });

  it("ignores the bookkeeping key and unknown cookies, and fills in missing sections", async () => {
    const text = JSON.stringify({ app: "investseek", schema: 1, exportedAt: NOW.toISOString(), data: { storage: { [META_STORAGE_KEY]: {} }, cookies: { session: "x", is_lang: "zh" } } });
    expect(await validateBackup(text)).toEqual({ ok: true, backup: backupOf({}, { cookies: { is_lang: "zh" } }) });
  });

  it("refuses files nested deeper than any store, quickly", async () => {
    const nested = (depth: number) =>
      `{"app":"investseek","schema":1,"exportedAt":"${NOW.toISOString()}","data":{"storage":{"investseek:x:v1":${"[".repeat(depth)}${"]".repeat(depth)}}}}`;
    expect((await validateBackup(nested(40))).ok).toBe(true);
    expect(await validateBackup(nested(100))).toEqual({ ok: false, error: "invalid" });
    // Brackets inside strings do not count.
    expect((await validateBackup(serializeBackup(backupOf({ "investseek:x:v1": "[".repeat(500) })))).ok).toBe(true);
    const started = Date.now();
    expect(await validateBackup(nested(1_000_000))).toEqual({ ok: false, error: "invalid" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reports a failed check when the validator cannot load, and loads it again for the next file", async () => {
    vi.resetModules();
    let loads = 0;
    vi.doMock("@/components/data/backup-schema", async () => {
      loads += 1;
      if (loads === 1) throw new Error("Failed to fetch dynamically imported module");
      return vi.importActual("@/components/data/backup-schema");
    });
    const fresh = await import("./backup");
    // Files that fail the quick checks never need the validator.
    expect(await fresh.validateBackup("{not json")).toEqual({ ok: false, error: "not_json" });
    expect(loads).toBe(0);
    expect(await fresh.validateBackup(valid)).toEqual({ ok: false, error: "check_failed" });
    expect((await fresh.validateBackup(valid)).ok).toBe(true);
    expect(loads).toBe(2);
    vi.doUnmock("@/components/data/backup-schema");
  });
});

describe("merge rules", () => {
  it("unites watchlists in this browser's order, capped", () => {
    expect(mergeWatchlist(["A", "B"], ["B", "C", "D"], 3)).toEqual({ list: ["A", "B", "C"], overflow: ["D"] });
  });

  it("lets incoming positions win per symbol, or replace them all", () => {
    const mine = { AAPL: { shares: 1, cost: 100 }, MSFT: { shares: 2, cost: 300 } };
    const theirs = { AAPL: { shares: 5, cost: 150 }, NVDA: { shares: 3, cost: 120 } };
    expect(mergeHoldings(mine, theirs, "merge")).toEqual({ AAPL: { shares: 5, cost: 150 }, MSFT: { shares: 2, cost: 300 }, NVDA: { shares: 3, cost: 120 } });
    expect(mergeHoldings(mine, theirs, "replace")).toEqual(theirs);
    expect(diffHoldings(mine, mergeHoldings(mine, theirs, "replace"))).toEqual({ added: ["NVDA"], updated: ["AAPL"], removed: ["MSFT"] });
  });

  it("keeps the newer note per symbol, and this browser's note on a tie", () => {
    const mine = { AAPL: note("mine, newer", "2026-11-05T00:00:00Z"), MSFT: note("mine, older", "2026-10-01T00:00:00Z"), TSLA: note("mine, tie", "2026-11-01T00:00:00Z") };
    const theirs = { AAPL: note("theirs, older", "2026-11-01T00:00:00Z"), MSFT: note("theirs, newer", "2026-11-02T00:00:00Z"), TSLA: note("theirs, tie", "2026-11-01T00:00:00Z"), NVDA: note("new", "2026-11-03T00:00:00Z") };
    const { book, keptLocal } = mergeNotes(mine, theirs);
    expect(Object.fromEntries(Object.entries(book).map(([s, n]) => [s, n.thesis]))).toEqual({ AAPL: "mine, newer", MSFT: "theirs, newer", TSLA: "mine, tie", NVDA: "new" });
    expect(keptLocal).toEqual(["AAPL", "TSLA"]);
  });
});

describe("parseBackup and the restore preview", () => {
  const current = {
    [WL]: '["AAPL","MSFT"]',
    [HOLD]: JSON.stringify({ AAPL: { shares: 10, cost: 150 }, MSFT: { shares: 5, cost: 300 } }),
    [NOTES]: JSON.stringify({ AAPL: note("mine", "2026-11-05T00:00:00.000Z") }),
    [ALERTS]: JSON.stringify([{ id: "a1", symbol: "AAPL", above: 200 }]),
    "investseek:chart:v1": '{"log":false,"ma200":true}',
  };
  const file = serializeBackup(
    backupOf(
      {
        [WL]: ["MSFT", "NVDA", "bad symbol!"],
        [HOLD]: { AAPL: { shares: 12, cost: 155 }, NVDA: { shares: 4, cost: 120 }, BAD: { shares: -1, cost: 1 } },
        [NOTES]: { AAPL: note("theirs, older", "2026-11-01T00:00:00.000Z"), NVDA: note("new", "2026-11-02T00:00:00.000Z") },
        [ALERTS]: [{ id: "a1", symbol: "AAPL", above: 210 }, { id: "a2", symbol: "NVDA", above: 150 }, { nope: true }],
        "investseek:screens:v1": [{ id: "s1", name: "Value" }],
      },
      { text: { "investseek:last-symbol": "NVDA" }, cookies: { is_theme: "light" } },
    ),
  );

  it("previews a merge per store", async () => {
    const result = await parseBackup(file, current, STORES);
    if (!result.ok) throw new Error(result.error);
    const merge = result.value.diff.merge;
    expect(merge.map((d) => d.key)).toEqual([WL, HOLD, NOTES, ALERTS, "investseek:last-symbol", "investseek:screens:v1"]);
    expect(find(merge, WL)).toMatchObject({ kind: "watchlist", added: ["NVDA"], changed: [], removed: [], invalid: 1 });
    expect(find(merge, HOLD)).toMatchObject({ kind: "holdings", added: ["NVDA"], changed: ["AAPL"], removed: [], invalid: 1 });
    expect(find(merge, NOTES)).toMatchObject({ kind: "notes", added: ["NVDA"], changed: [], removed: [], keptLocal: ["AAPL"] });
    expect(find(merge, ALERTS)).toMatchObject({ kind: "store", added: ["a2"], changed: ["a1"], removed: [] });
    expect(find(merge, "investseek:last-symbol")).toMatchObject({ kind: "other", added: ["investseek:last-symbol"] });
    expect(find(merge, "investseek:screens:v1")).toMatchObject({ kind: "other", added: ["s1"] });
  });

  it("previews a replace, including what it removes", async () => {
    const result = await parseBackup(file, current, STORES);
    if (!result.ok) throw new Error(result.error);
    const replace = result.value.diff.replace;
    expect(find(replace, WL)).toMatchObject({ added: ["NVDA"], removed: ["AAPL"] });
    expect(find(replace, HOLD)).toMatchObject({ added: ["NVDA"], changed: ["AAPL"], removed: ["MSFT"] });
    expect(find(replace, NOTES)).toMatchObject({ added: ["NVDA"], changed: ["AAPL"], keptLocal: [] });
    expect(find(replace, "investseek:chart:v1")).toMatchObject({ kind: "other", removed: ["log", "ma200"] });
    expect(replace.every((d) => hasChanges(d))).toBe(true);
  });

  it("passes on file errors", async () => {
    expect(await parseBackup("nope", current, STORES)).toEqual({ ok: false, error: "not_json" });
  });

  it("measures a missing watchlist against the starter list the app shows, but does not merge into it", () => {
    // The starter list is not the user's: with no saved list, Merge takes the file's list as it is.
    const merge = planRestore({ "investseek:recents:v1": '["AAPL"]' }, backupOf({ [WL]: ["TSLA", "NVDA"] }), "merge", { stores: STORES });
    expect(JSON.parse(merge.writes[WL] as string)).toEqual(["TSLA", "NVDA"]);
    expect(find(merge.diffs, WL)).toMatchObject({ added: ["TSLA"], removed: DEFAULT_WATCHLIST.filter((symbol) => symbol !== "NVDA") });
    // An unreadable saved list is shown as the starter list too.
    expect(JSON.parse(planRestore({ [WL]: "{oops" }, backupOf({ [WL]: ["TSLA"] }), "merge", { stores: STORES }).writes[WL] as string)).toEqual(["TSLA"]);
    // A saved list is the user's, even when it holds the starter symbols.
    const saved = planRestore({ [WL]: JSON.stringify(DEFAULT_WATCHLIST) }, backupOf({ [WL]: ["TSLA"] }), "merge", { stores: STORES });
    expect(JSON.parse(saved.writes[WL] as string)).toEqual([...DEFAULT_WATCHLIST, "TSLA"]);
    const replace = planRestore({ [WL]: '["TSLA"]' }, backupOf({}), "replace", { stores: STORES });
    expect(replace.writes).toEqual({ [WL]: null });
    expect(find(replace.diffs, WL)).toMatchObject({ added: DEFAULT_WATCHLIST, removed: ["TSLA"] });
  });

  it("counts a new watchlist order as a change, so Replace can apply it", () => {
    const current = { [WL]: '["AAPL","MSFT","NVDA"]' };
    const reordered = backupOf({ [WL]: ["NVDA", "AAPL", "MSFT"] });
    const replace = planRestore(current, reordered, "replace", { stores: STORES });
    expect(find(replace.diffs, WL)).toMatchObject({ added: [], changed: ["NVDA", "AAPL", "MSFT"], removed: [] });
    expect(replace.writes[WL]).toBe('["NVDA","AAPL","MSFT"]');
    // Merge keeps this browser's order.
    const merge = planRestore(current, reordered, "merge", { stores: STORES });
    expect(merge.writes).toEqual({});
    expect(merge.diffs.some(hasChanges)).toBe(false);
  });

  it("offers Replace first only when nothing but browsing history is stored", () => {
    expect(defaultRestoreMode({})).toBe("replace");
    expect(defaultRestoreMode({ "investseek:last-symbol": "AAPL", "investseek:recents:v1": '["AAPL"]', "investseek:last-sector:v1": '"tech"', [META_STORAGE_KEY]: "{}" })).toBe("replace");
    expect(defaultRestoreMode({ "investseek:last-symbol": "AAPL", [WL]: '["AAPL"]' })).toBe("merge");
    expect(defaultRestoreMode({ "investseek:chart:v1": '{"log":true}' })).toBe("merge");
    expect(defaultRestoreMode({ "investseek:mystery:v1": "1" })).toBe("merge");
  });

  it("keeps this browser's copy of a store the file has in the wrong shape", () => {
    const plan = planRestore(current, backupOf({ [WL]: "AAPL", [HOLD]: [1, 2] }, { text: { [NOTES]: "not json" } }), "replace", { stores: STORES });
    expect(plan.writes[WL]).toBeUndefined();
    expect(plan.writes[HOLD]).toBeUndefined();
    expect(plan.writes[NOTES]).toBeUndefined();
    for (const key of [WL, HOLD, NOTES]) expect(find(plan.diffs, key)).toMatchObject({ rejected: true, added: [], removed: [] });
    // Replace still removes what the file does not have.
    expect(plan.writes[ALERTS]).toBeNull();
  });

  it("lists preference changes and plans cookies only when asked", () => {
    const backup = backupOf({}, { cookies: { is_theme: "light", is_lang: "en" } });
    expect(prefChanges(backup, { is_lang: "en", is_theme: "dark" })).toEqual([{ name: "is_theme", from: "dark", to: "light" }]);
    expect(planRestore({}, backup, "merge", { stores: STORES }).cookies).toEqual({});
    expect(planRestore({}, backup, "merge", { stores: STORES, cookies: { is_theme: "dark" } }).cookies).toEqual({ is_theme: "light", is_lang: "en" });
  });

  it("writes nothing when the browser already matches the file", () => {
    const snapshot = { [WL]: '["AAPL"]', [HOLD]: '{"AAPL":{"shares":1,"cost":2}}' };
    const backup = createBackup(snapshot, {}, NOW);
    for (const mode of ["merge", "replace"] as const) {
      const plan = planRestore(snapshot, backup, mode, { stores: STORES });
      expect(plan.writes).toEqual({});
      expect(plan.diffs.some(hasChanges)).toBe(false);
    }
  });
});

describe("applyBackup", () => {
  it("merges into the latest stored values, sanitizing known and registered stores", () => {
    const storage = new MemoryStorage({ [WL]: '["AAPL"]', [HOLD]: JSON.stringify({ AAPL: { shares: 1, cost: 100 } }), "investseek:keep:v1": "1" });
    const { env, notified } = makeEnv(storage);
    const backup = backupOf({ [WL]: ["MSFT"], [HOLD]: { MSFT: { shares: 2, cost: 300 } }, [ALERTS]: [{ id: "x", symbol: "MSFT", above: 1 }, "junk"] });
    const result = applyBackup(backup, "merge", env);
    expect(JSON.parse(storage.getItem(WL)!)).toEqual(["AAPL", "MSFT"]);
    expect(JSON.parse(storage.getItem(HOLD)!)).toEqual({ AAPL: { shares: 1, cost: 100 }, MSFT: { shares: 2, cost: 300 } });
    expect(JSON.parse(storage.getItem(ALERTS)!)).toEqual([{ id: "x", symbol: "MSFT", above: 1 }]);
    expect(storage.getItem("investseek:keep:v1")).toBe("1");
    expect(result.changes.map((c) => c.key).sort()).toEqual([ALERTS, HOLD, WL].sort());
    expect(notified).toEqual([result.changes]);
    expect(result.cookies).toEqual([]);
  });

  it("replaces everything except the bookkeeping and keys outside the app", () => {
    const storage = new MemoryStorage({ [WL]: '["AAPL"]', "investseek:gone:v1": "{}", [META_STORAGE_KEY]: '{"lastBackupAt":"2026-11-01T00:00:00.000Z"}', foreign: "keep" });
    const { env } = makeEnv(storage);
    applyBackup(backupOf({ [HOLD]: { NVDA: { shares: 1, cost: 100 } } }), "replace", env);
    expect(storage.toObject()).toEqual({ [META_STORAGE_KEY]: '{"lastBackupAt":"2026-11-01T00:00:00.000Z"}', foreign: "keep", [HOLD]: '{"NVDA":{"shares":1,"cost":100}}' });
  });

  it("sets preference cookies only when asked, and reports what they replaced", () => {
    const backup = backupOf({}, { cookies: { is_lang: "zh", is_theme: "light" } });
    const off = makeEnv(new MemoryStorage(), { is_lang: "en" });
    expect(applyBackup(backup, "merge", off.env).cookies).toEqual([]);
    expect(off.jar).toEqual({ is_lang: "en" });
    const on = makeEnv(new MemoryStorage(), { is_lang: "en" });
    expect(applyBackup(backup, "merge", on.env, { prefs: true }).cookies).toEqual([
      { name: "is_lang", oldValue: "en", newValue: "zh" },
      { name: "is_theme", oldValue: null, newValue: "light" },
    ]);
    expect(on.jar).toEqual({ is_lang: "zh", is_theme: "light" });
  });

  it("changes nothing when storage runs out of room midway", () => {
    const before = { [WL]: '["AAPL"]', [HOLD]: '{"AAPL":{"shares":1,"cost":100}}', "investseek:old:v1": "1" };
    const storage = new MemoryStorage(before);
    storage.failOnWrite = 2;
    const { env, notified, jar } = makeEnv(storage);
    const backup = backupOf({ [WL]: ["MSFT"], [HOLD]: { MSFT: { shares: 2, cost: 300 } } }, { cookies: { is_lang: "zh" } });
    expect(() => applyBackup(backup, "replace", env, { prefs: true })).toThrow(StorageWriteError);
    expect(storage.toObject()).toEqual(before);
    expect(notified).toEqual([]);
    expect(jar).toEqual({});
  });
});

describe("writeAtomically", () => {
  it("removes before writing, skips unchanged values and reports old values", () => {
    const storage = new MemoryStorage({ "investseek:a": "1", "investseek:b": "2" });
    const changes = writeAtomically(storage, { "investseek:c": "3", "investseek:a": null, "investseek:b": "2" });
    expect(changes).toEqual([
      { key: "investseek:a", oldValue: "1", newValue: null },
      { key: "investseek:c", oldValue: null, newValue: "3" },
    ]);
  });

  it("refuses keys outside the prefix, putting back what it wrote", () => {
    const storage = new MemoryStorage({ "investseek:a": "1" });
    expect(() => writeAtomically(storage, { "investseek:a": "2", "other:key": "x" })).toThrow(StorageWriteError);
    expect(storage.toObject()).toEqual({ "investseek:a": "1" });
  });

  it("classifies quota errors", () => {
    const storage = new MemoryStorage();
    storage.failOnWrite = 1;
    try {
      writeAtomically(storage, { "investseek:a": "1" });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageWriteError);
      expect((error as StorageWriteError).reason).toBe("quota");
    }
  });
});

describe("undo and clear", () => {
  it("undoes changes for keys nobody touched since", () => {
    const storage = new MemoryStorage({ "investseek:a": "1", "investseek:b": "2" });
    const { env, notified } = makeEnv(storage);
    const changes = applyWrites(env, { "investseek:a": "10", "investseek:b": null, "investseek:c": "30" });
    storage.setItem("investseek:c", "changed elsewhere");
    const reverted = undoChanges(env, changes);
    expect(storage.toObject()).toEqual({ "investseek:a": "1", "investseek:b": "2", "investseek:c": "changed elsewhere" });
    expect(reverted.map((c) => c.key).sort()).toEqual(["investseek:a", "investseek:b"]);
    expect(notified).toHaveLength(2);
  });

  it("clears every app key, the bookkeeping too, and nothing else", () => {
    const storage = new MemoryStorage({ [WL]: "[]", [META_STORAGE_KEY]: "{}", foreign: "keep" });
    const { env } = makeEnv(storage);
    const changes = clearAllData(env);
    expect(storage.toObject()).toEqual({ foreign: "keep" });
    expect(changes).toHaveLength(2);
    undoChanges(env, changes);
    expect(storage.toObject()).toEqual({ foreign: "keep", [WL]: "[]", [META_STORAGE_KEY]: "{}" });
  });
});

describe("backup bookkeeping and display helpers", () => {
  it("sanitizes the backup record", () => {
    expect(sanitizeBackupMeta({ lastBackupAt: "2026-11-01T10:00:00.000Z" })).toEqual({ lastBackupAt: "2026-11-01T10:00:00.000Z" });
    expect(sanitizeBackupMeta({ lastBackupAt: "soon" })).toEqual({ lastBackupAt: null });
    expect(sanitizeBackupMeta(null)).toEqual({ lastBackupAt: null });
  });

  it("counts calendar days since the last backup", () => {
    const now = new Date(2026, 10, 7, 9, 0);
    expect(backupAgeDays(null, now)).toBeNull();
    expect(backupAgeDays("garbage", now)).toBeNull();
    expect(backupAgeDays(new Date(2026, 10, 7, 0, 5).toISOString(), now)).toBe(0);
    expect(backupAgeDays(new Date(2026, 10, 6, 23, 59).toISOString(), now)).toBe(1);
    expect(backupAgeDays(new Date(2026, 9, 8, 12).toISOString(), now)).toBe(30);
    expect(backupAgeDays(new Date(2026, 10, 8).toISOString(), now)).toBe(0);
  });

  it("formats sizes and names stores", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3482)).toBe("3.4 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(byteLength("代码")).toBe(6);
    expect(storeName("investseek:alert-log:v1")).toBe("alert-log");
    expect(storeName("investseek:last-symbol")).toBe("last-symbol");
    expect(countEntries([1, 2])).toBe(2);
    expect(countEntries({ a: 1 })).toBe(1);
    expect(countEntries("AAPL")).toBeNull();
  });

  it("lists stored items with sizes, known stores first", () => {
    const items = storedItems({ "investseek:zeta:v1": "[]", [HOLD]: "{}", "investseek:last-symbol": "AAPL", [WL]: '["A"]', [META_STORAGE_KEY]: "{}" });
    expect(items.map((item) => item.key)).toEqual([WL, HOLD, "investseek:last-symbol", "investseek:zeta:v1"]);
    expect(items[0]).toEqual({ key: WL, value: ["A"], bytes: WL.length + 5 });
    expect(items[2].value).toBe("AAPL");
  });
});

describe("module side effects", () => {
  it("registers the bookkeeping store without touching storage", async () => {
    const { registeredLocalStores } = await import("./local-store");
    expect(registeredLocalStores().has(META_STORAGE_KEY)).toBe(true);
  });
});
