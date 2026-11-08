import { describe, expect, it } from "vitest";

import { hideClass, queriesContainer, type Breakpoint, type ContainerBreakpoint } from "./table-hide";

const VIEWPORT: Breakpoint[] = ["sm", "md", "lg", "xl"];
const CONTAINER: ContainerBreakpoint[] = ["3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];

describe("hideClass", () => {
  it("hides cells and cols below a viewport breakpoint", () => {
    for (const bp of VIEWPORT) {
      expect(hideClass({ hideBelow: bp })).toBe(`hidden ${bp}:table-cell`);
      expect(hideClass({ hideBelow: bp }, "col")).toBe(`hidden ${bp}:table-column`);
    }
  });

  it("hides cells and cols while the table's box is narrower than a container size", () => {
    for (const size of CONTAINER) {
      expect(hideClass({ hideBelowContainer: size })).toBe(`hidden @${size}:table-cell`);
      expect(hideClass({ hideBelowContainer: size }, "col")).toBe(`hidden @${size}:table-column`);
    }
  });

  it("hides them below 50rem with Tailwind's arbitrary container size, which has no name of its own", () => {
    expect(hideClass({ hideBelowContainer: "50rem" })).toBe("hidden @min-[50rem]:table-cell");
    expect(hideClass({ hideBelowContainer: "50rem" }, "col")).toBe("hidden @min-[50rem]:table-column");
  });

  it("lets the container size take the place of the viewport breakpoint", () => {
    expect(hideClass({ hideBelow: "sm", hideBelowContainer: "md" })).toBe("hidden @md:table-cell");
    expect(hideClass({ hideBelow: "lg", hideBelowContainer: "xs" }, "col")).toBe("hidden @xs:table-column");
  });

  it("adds nothing for a column that always shows", () => {
    expect(hideClass({})).toBeUndefined();
    expect(hideClass({}, "col")).toBeUndefined();
  });
});

describe("queriesContainer", () => {
  it("is true once a column hides by the table's width", () => {
    expect(queriesContainer([{}, { hideBelow: "sm" }])).toBe(false);
    expect(queriesContainer([{}, { hideBelowContainer: "sm" }])).toBe(true);
    expect(queriesContainer([])).toBe(false);
  });
});
