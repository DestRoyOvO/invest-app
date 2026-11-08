import { describe, expect, it } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { failureText, waitText } from "./copy";

const EN = MESSAGES.en;
const ZH = MESSAGES.zh;

describe("AI copy", () => {
  it("shows short waits in seconds and long ones in minutes or hours", () => {
    expect(waitText(45, EN)).toBe("45 s");
    expect(waitText(600, EN)).toBe("10 min");
    expect(waitText(30_000, EN)).toBe("9 h");
    expect(waitText(undefined, ZH)).toBe("60 秒");
  });

  it("explains every failure", () => {
    expect(failureText({ kind: "rate_limited", retryAfter: 600 }, EN)).toBe("Too many requests. Try again in 10 min.");
    expect(failureText({ kind: "rate_limited", retryAfter: 30_000, daily: true }, EN)).toBe("The daily AI limit of this server is used up. It resets in 9 h.");
    expect(failureText({ kind: "rate_limited", retryAfter: 90 }, ZH)).toBe("请求过于频繁，请 90 秒后再试。");
    expect(failureText({ kind: "model_limit" }, EN)).toContain("deepseek-chat");
    expect(failureText({ kind: "not_configured" }, EN)).toContain("DEEPSEEK_API_KEY");
    expect(failureText({ kind: "unavailable" }, EN)).toContain("ACCESS_PASSWORD");
    expect(failureText({ kind: "interrupted" }, EN)).toBe(EN.ai.interrupted);
    expect(failureText({ kind: "failed" }, EN)).toBe(EN.ai.failed);
  });

  it("never uses em dashes in the AI strings", () => {
    const strings = (value: unknown): string[] => (typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []);
    for (const text of [...strings(EN.ai), ...strings(ZH.ai)]) expect(text).not.toMatch(/[—–]/);
  });
});
