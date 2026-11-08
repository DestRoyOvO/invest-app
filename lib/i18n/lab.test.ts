import { describe, expect, it } from "vitest";

import type { FactorResearch } from "@/lib/evaluation";
import factorResearchJson from "@/lib/factor-research.json";
import { tpl } from "@/lib/format";

import { labMessages } from "./lab";
import { MESSAGES } from "./messages";
import { riskMessages } from "./risk";

const RESEARCH = factorResearchJson as unknown as FactorResearch;

function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node && typeof node === "object") return Object.values(node).flatMap(strings);
  return [];
}

describe("lab and risk copy", () => {
  it("states the adoption rule exactly as the research script recorded it", () => {
    const tests = RESEARCH.factors.length * RESEARCH.horizons.length;
    expect(tpl(labMessages.en.factors.rule, { tests, alpha: RESEARCH.alpha })).toBe(RESEARCH.rule);
  });

  it("uses no em dashes in either language", () => {
    const all = [labMessages.en, labMessages.zh, riskMessages.en, riskMessages.zh, MESSAGES.en.signal, MESSAGES.zh.signal].flatMap(strings);
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((text) => text.includes("—"))).toEqual([]);
  });

  it("keeps the same placeholders in English and Chinese", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const pairs: Array<[unknown, unknown]> = [
      [labMessages.en, labMessages.zh],
      [riskMessages.en, riskMessages.zh],
      [MESSAGES.en.signal, MESSAGES.zh.signal],
    ];
    for (const [en, zh] of pairs) {
      const a = strings(en);
      const b = strings(zh);
      expect(b.length).toBe(a.length);
      a.forEach((text, i) => expect(placeholders(b[i])).toEqual(placeholders(text)));
    }
  });
});
