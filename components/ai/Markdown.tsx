import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/cn";

// Minimal, safe Markdown for AI output: headings (#..###), "- " / "* " bullets, numbered items and **bold**.
// Everything renders as React text nodes, so model output can never inject HTML.

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

type Block = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

function parse(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (heading) blocks.push({ kind: "h", text: heading[1].replace(/\*\*/g, "") });
    else if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else if (numbered) {
      if (last?.kind === "ol") last.items.push(numbered[1]);
      else blocks.push({ kind: "ol", items: [numbered[1]] });
    } else blocks.push({ kind: "p", text: line });
  }
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text);
  return (
    <div className={cn("space-y-2.5 text-sm leading-relaxed text-fg-2", className)}>
      {blocks.map((block, i) => {
        if (block.kind === "h")
          return (
            <h3 key={i} className="label pt-1.5 text-fg-2 first:pt-0">
              {block.text}
            </h3>
          );
        if (block.kind === "ul")
          return (
            <ul key={i} className="space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.6em] size-1 shrink-0 bg-fg-3" />
                  <span className="min-w-0">{inline(item)}</span>
                </li>
              ))}
            </ul>
          );
        if (block.kind === "ol")
          return (
            <ol key={i} className="space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span aria-hidden className="num shrink-0 text-fg-3">
                    {j + 1}.
                  </span>
                  <span className="min-w-0">{inline(item)}</span>
                </li>
              ))}
            </ol>
          );
        return <p key={i}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
