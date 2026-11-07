import { defineMessages } from "./define";

// The unlock page of a private site (SITE_ACCESS=private). zh is typed against en; add keys to both.
export const accessMessages = defineMessages(
  {
    pageTitle: "Unlock",
    title: "Private workstation",
    body: "This InvestSeek deployment is private. Enter the access password to open it.",
    password: "Access password",
    submit: "Unlock",
    checking: "Checking…",
    opening: "Opening…",
    wrongPassword: "Wrong password.",
    rateLimited: "Too many attempts. Try again in {s} s.",
    rateLimitedMinutes: "Too many attempts. Try again in {m} min.",
    unavailable: "Sign-in is not available on this server right now.",
    failed: "Sign-in failed. Please retry.",
  },
  {
    pageTitle: "解锁",
    title: "私有工作台",
    body: "这个 InvestSeek 部署设为私有。输入访问密码后即可打开。",
    password: "访问密码",
    submit: "解锁",
    checking: "验证中…",
    opening: "正在打开…",
    wrongPassword: "密码错误。",
    rateLimited: "尝试次数过多，请 {s} 秒后再试。",
    rateLimitedMinutes: "尝试次数过多，请 {m} 分钟后再试。",
    unavailable: "此服务器暂时无法登录。",
    failed: "登录失败，请重试。",
  },
);
