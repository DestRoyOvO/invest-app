import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { DASH } from "@/lib/format";

// Source-level checks for rules in docs/design-system.md that the primitives must keep and a unit test cannot see.

const dir = join(process.cwd(), "components", "ui");
/** The source without comments: comments may mention what the code must not contain. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sources = readdirSync(dir)
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
  .map((name) => ({ name, code: code(readFileSync(join(dir, name), "utf8")) }));

/** Every component source of the app (components/ and app/), tests excluded, without comments. */
function appSources(): Array<{ name: string; code: string }> {
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) files.push(path);
    }
  };
  walk(join(process.cwd(), "components"));
  walk(join(process.cwd(), "app"));
  return files.map((path) => ({ name: relative(process.cwd(), path).replaceAll("\\", "/"), code: code(readFileSync(path, "utf8")) }));
}

/**
 * The opening tags of a JSX element in a source, from `<Tag` to the `>` that closes it. Braces and quotes are tracked,
 * so arrow functions and nested elements inside the props do not end the tag early.
 */
function openingTags(source: string, tag: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(new RegExp(`<${tag}(?=[\\s/>])`, "g"))) {
    let depth = 0;
    let quote: string | null = null;
    let end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

/** A phone height or size of 40px set from outside: `max-sm:h-10`, `max-sm:min-h-10`, `max-sm:size-10`, also on a descendant. */
const PHONE_OVERRIDE = /(?:^|[\s"'`])(?:\[&[^\s"'`]*?\]:)?max-sm:(?:\[&[^\s"'`]*?\]:)?(?:min-)?(?:h|size)-10(?![\w-])/;
/** A class that reaches into a primitive's segments, tabs or select to set its height. */
const INNER_OVERRIDE = /(?:max-sm:)?\[&(?:_|>)(?:\[role=(?:radio|tab)\]|select|button)\]:(?:max-sm:)?(?:min-)?h-10(?![\w-])/;
/** The controls with a built-in 40px phone target (PHONE_TARGET), and SymbolCombobox, whose inputClassName reaches its Input. */
const TARGET_PRIMITIVES = ["Button", "IconButton", "Input", "Select", "Segmented", "Tabs", "SymbolCombobox"];

describe("components/ui conventions", () => {
  it("shows a missing value as DASH from lib/format, never a typed em or en dash", () => {
    expect(DASH).toBe("—");
    expect(sources.filter((file) => /[–—]/.test(file.code)).map((file) => file.name)).toEqual([]);
  });

  it("puts no <header> inside a dialog, where it would be a second banner landmark", () => {
    const dialogs = sources.filter((file) => file.code.includes('role="dialog"'));
    expect(dialogs.map((file) => file.name)).toContain("Drawer.tsx");
    expect(dialogs.filter((file) => file.code.includes("<header")).map((file) => file.name)).toEqual([]);
  });
});

describe("phone targets in pages", () => {
  const pages = appSources();

  it("finds the opening tag of an element through arrow functions and nested elements", () => {
    const source = '<Button size="sm" onClick={() => open(a > b)} icon={<X className="size-3" />} className="ml-auto">Go</Button><Buttons />';
    expect(openingTags(source, "Button")).toEqual(['<Button size="sm" onClick={() => open(a > b)} icon={<X className="size-3" />} className="ml-auto">']);
    expect(PHONE_OVERRIDE.test('className="ml-auto max-sm:h-10"')).toBe(true);
    expect(PHONE_OVERRIDE.test('className="[&_[role=radio]]:max-sm:h-10"')).toBe(true);
    expect(PHONE_OVERRIDE.test('className="max-sm:h-11 max-sm:px-3"')).toBe(false);
    expect(INNER_OVERRIDE.test("max-sm:[&_[role=tab]]:h-10")).toBe(true);
    expect(INNER_OVERRIDE.test("w-full [&>select]:max-sm:text-sm")).toBe(false);
  });

  it("add no 40px phone heights to the controls that bring their own (docs/design-system.md, phone sizes)", () => {
    expect(pages.length).toBeGreaterThan(100);
    const offenders = pages.flatMap((file) =>
      TARGET_PRIMITIVES.flatMap((tag) => openingTags(file.code, tag).filter((open) => PHONE_OVERRIDE.test(open)).map((open) => `${file.name}: ${open.slice(0, 120)}`)),
    );
    expect(offenders).toEqual([]);
  });

  it("do not reach into Segmented, Tabs or Select to set their height", () => {
    expect(pages.filter((file) => INNER_OVERRIDE.test(file.code)).map((file) => file.name)).toEqual([]);
  });
});
