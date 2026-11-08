// The README images (the screenshot block of README.md and README.zh-CN.md), each with the project of
// playwright.config.ts that captures it: readme.shots.ts writes them (e2e/support/shots.ts checks that each is
// captured by its project) and the global setup's teardown checks that a run wrote every one of them, at its
// project's size, into the folder it was asked for. No Playwright imports here: the global setup reads this module.

export const README_IMAGES = {
  "overview-dark-en.png": "desktop",
  "quote-dark-en.png": "desktop",
  "portfolio-dark-en.png": "desktop",
  "calendar-dark-en.png": "desktop",
  "screener-dark-en.png": "desktop",
  "lab-dark-en.png": "desktop",
  "markets-dark-en.png": "desktop",
  "overview-light-zh.png": "desktop",
  "mobile-light-zh.png": "phone",
} as const satisfies Record<string, "desktop" | "phone">;

export type ReadmeImage = keyof typeof README_IMAGES;
