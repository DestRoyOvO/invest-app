// Relative link checker for the Markdown docs: every link, image and HTML src/href in the root *.md files and docs/*.md
// that points into the repository must exist, and an #anchor into a Markdown file must match one of its headings (with
// GitHub's slug rules) or an HTML id/name. External links (http:, mailto: ...) are not fetched.
//
//   npx tsx scripts/check-links.ts                  (exits 1 when a target is missing)
//   npx tsx scripts/check-links.ts README.md docs   (only these files or folders)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();

interface Link {
  file: string;
  line: number;
  target: string;
}

interface Problem extends Link {
  reason: string;
}

/** Repository-relative path with forward slashes. */
function repoPath(absolute: string): string {
  return relative(ROOT, absolute).split(sep).join("/");
}

/** The Markdown files to check: the arguments (files or folders), or every *.md in the root and in docs/. */
function markdownFiles(args: readonly string[]): string[] {
  const inFolder = (folder: string) =>
    readdirSync(folder)
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .map((name) => join(folder, name));
  if (args.length === 0) return [...inFolder(ROOT), ...inFolder(join(ROOT, "docs"))].sort();
  return args.flatMap((arg) => {
    const path = resolve(ROOT, arg);
    return statSync(path).isDirectory() ? inFolder(path) : [path];
  });
}

/** Blanks out code (fenced blocks, inline spans) and HTML comments, keeping every line break so line numbers hold. */
function proseOnly(markdown: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, blank).split("\n");
  let fence: string | null = null;
  const out = lines.map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return blank(line);
    }
    if (marker) {
      fence = marker[1];
      return blank(line);
    }
    return line.replace(/(`+)[^`]*?\1/g, blank);
  });
  return out.join("\n");
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Every link target in the prose: inline links and images, reference definitions, and HTML src and href values. */
function extractLinks(file: string, markdown: string): Link[] {
  const text = proseOnly(markdown);
  const links: Link[] = [];
  const patterns = [
    /\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g,
    /^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/gm,
    /\s(?:src|href)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[2] ?? "").replace(/^<|>$/g, "").trim();
      if (raw) links.push({ file, line: lineAt(text, match.index ?? 0), target: raw });
    }
  }
  return links;
}

// GitHub's heading anchors (github-slugger): lower case, drop everything but letters, marks, numbers, connector
// punctuation, hyphens and spaces, then turn each space into a hyphen. Repeated headings get -1, -2 ...
const NOT_SLUG = new RegExp("[^\\p{L}\\p{M}\\p{N}\\p{Pc}\\- ]", "gu");

function slug(heading: string): string {
  const text = heading
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
  return text.toLowerCase().replace(NOT_SLUG, "").replace(/ /g, "-");
}

const anchorCache = new Map<string, Set<string>>();

/** The anchors a Markdown file offers: heading slugs and HTML id or name attributes. */
function anchorsOf(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const lines = proseOnly(readFileSync(path, "utf8")).split("\n");
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const add = (heading: string) => {
    const base = slug(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  };
  lines.forEach((line, i) => {
    const atx = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (atx) add(atx[1]);
    else if (/^\s{0,3}(=+|-+)\s*$/.test(line) && i > 0 && /\S/.test(lines[i - 1]) && !/^\s*([-*+|>#]|\d+\.)/.test(lines[i - 1])) {
      add(lines[i - 1].trim());
    }
    for (const match of line.matchAll(/\s(?:id|name)\s*=\s*"([^"]+)"/g)) anchors.add(match[1].toLowerCase());
  });
  anchorCache.set(path, anchors);
  return anchors;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type Verdict = { status: "ok" } | { status: "broken"; reason: string };

/** Whether a link's target exists, including generated screenshots committed with the docs. */
function check(link: Link): Verdict {
  const { target } = link;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return { status: "ok" };
  const hash = target.indexOf("#");
  const pathPart = (hash >= 0 ? target.slice(0, hash) : target).split("?")[0];
  const anchor = hash >= 0 ? safeDecode(target.slice(hash + 1)).toLowerCase() : "";
  const decoded = safeDecode(pathPart);
  const absolute = decoded === "" ? link.file : decoded.startsWith("/") ? join(ROOT, decoded) : resolve(dirname(link.file), decoded);
  const inRepo = repoPath(absolute);
  if (inRepo.startsWith("..")) return { status: "broken", reason: `points outside the repository (${inRepo})` };
  if (!existsSync(absolute)) {
    return { status: "broken", reason: `missing file ${inRepo}` };
  }
  if (anchor && absolute.toLowerCase().endsWith(".md") && !anchorsOf(absolute).has(anchor)) {
    return { status: "broken", reason: `no heading or id "${anchor}" in ${inRepo}` };
  }
  return { status: "ok" };
}

const files = markdownFiles(process.argv.slice(2));
const problems: Problem[] = [];
let checked = 0;

for (const file of files) {
  for (const link of extractLinks(file, readFileSync(file, "utf8"))) {
    checked++;
    const verdict = check(link);
    if (verdict.status === "broken") {
      problems.push({ ...link, reason: verdict.reason });
    }
  }
}

console.log(`Checked ${checked} links in ${files.length} Markdown files.`);
if (problems.length > 0) {
  console.log(`\nBroken (${problems.length}):`);
  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (const p of problems) console.log(`  ${repoPath(p.file)}:${p.line}  ${p.target}  (${p.reason})`);
  process.exitCode = 1;
} else {
  console.log("\nNo broken relative links.");
}
