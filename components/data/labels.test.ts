import { describe, expect, it } from "vitest";

import type { StoreDiff } from "@/lib/backup";
import { MESSAGES } from "@/lib/i18n/messages";

import { diffSummary, formatShares, lastBackupLabel, prefNameLabel, prefValueLabel, storeLabel, symbolList } from "./labels";

const en = MESSAGES.en;
const zh = MESSAGES.zh;

function diff(added: string[], changed: string[], removed: string[]): StoreDiff {
  return { key: "investseek:x:v1", kind: "other", added, changed, removed, invalid: 0, rejected: false, keptLocal: [], overflow: [] };
}

describe("data labels", () => {
  it("names known stores and leaves others unnamed, ignoring inherited keys", () => {
    expect(storeLabel(en, "investseek:holdings:v1")).toBe("Positions");
    expect(storeLabel(zh, "investseek:alert-log:v1")).toBe("提醒记录");
    expect(storeLabel(en, "investseek:last-symbol")).toBe("Last viewed symbol");
    expect(storeLabel(en, "investseek:mystery:v2")).toBeNull();
    expect(storeLabel(en, "investseek:constructor:v1")).toBeNull();
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

  it("sums store diffs", () => {
    expect(diffSummary(en, [diff(["A", "B"], [], ["C"]), diff(["D"], ["E"], [])])).toBe("3 added, 1 changed, 1 removed");
    expect(diffSummary(zh, [])).toBe("新增 0 项，修改 0 项，移除 0 项");
  });

  it("formats share counts and symbol lists", () => {
    expect(formatShares(25, "en")).toBe("25");
    expect(formatShares(3.5, "en")).toBe("3.5");
    expect(formatShares(1234.125, "zh")).toBe("1,234.125");
    expect(symbolList(["A", "B"])).toBe("A, B");
    expect(symbolList(["A", "B", "C", "D"], 2)).toBe("A, B +2");
  });
});
