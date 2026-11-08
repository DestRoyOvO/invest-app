"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Kbd } from "@/components/ui/Badge";
import { useLastSymbol } from "@/hooks/useLastSymbol";
import { useLastSector } from "@/hooks/useRecents";
import { stockPath } from "@/lib/api-client";
import { tpl } from "@/lib/format";
import { suggestForPath } from "@/lib/functions";

import { CodeChip } from "./CodeChip";

const chipClass =
  "inline-flex h-8 items-center gap-2 rounded-xs border border-line-2 bg-panel px-2 text-sm text-fg-2 transition-colors hover:border-accent hover:text-fg max-sm:h-10";

/**
 * 404 inside the terminal: "ERR 404 /path · unknown function", a command line that opens the command bar with whatever
 * the reader types, and functions whose names are close to the path.
 */
export function NotFoundView() {
  const t = useT();
  const pathname = usePathname();
  const lastSymbol = useLastSymbol();
  const lastSector = useLastSector();
  const { openCommand, openCommandWith } = useUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const headingId = useId();
  const nf = t.shell.notFound;
  const suggestions = useMemo(() => suggestForPath(pathname, { lastSymbol, lastSector }), [pathname, lastSymbol, lastSector]);

  // The command line is ready on arrival with a keyboard and a fine pointer (on phones it would pop the keyboard up).
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Hands the first typed text to the command bar. "/" (the command bar key, shown as this field's hint) opens it
  // empty rather than as typed text, and a pasted "/nvda" arrives as "nvda".
  const handOver = () => {
    const input = inputRef.current;
    if (!input || composing.current) return;
    const typed = input.value;
    if (!typed.trim()) return;
    input.value = "";
    const text = typed.replace(/^\s*\/+/, "");
    if (text.trim()) openCommandWith(text);
    else openCommand();
  };

  return (
    <div className="grid gap-px bg-line p-px">
      <section aria-labelledby={headingId} className="bg-panel">
        <div className="border-b border-line bg-panel-2 px-3 py-2.5">
          <h1 id={headingId} className="mono flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-accent">{nf.code}</span>
            <span className="break-all text-fg">{tpl(nf.unknown, { path: pathname })}</span>
          </h1>
        </div>
        <div className="space-y-4 p-3">
          <p className="text-sm text-fg-2">{nf.body}</p>
          <label className="flex h-10 w-full max-w-xl items-center gap-2 rounded-xs border border-input-border bg-input-bg px-2.5 transition-colors focus-within:border-accent hover:border-fg-3">
            <span aria-hidden className="mono text-accent">
              &gt;
            </span>
            <span className="sr-only">{nf.prompt}</span>
            <input
              ref={inputRef}
              type="text"
              placeholder={nf.prompt}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              onInput={handOver}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
                handOver();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  openCommand();
                }
              }}
              className="mono h-full min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-3 focus:outline-none max-sm:text-base"
            />
            <span aria-hidden className="hidden sm:inline-flex">
              <Kbd>/</Kbd>
            </span>
          </label>
          <div className="space-y-1.5">
            <h2 className="col-head">{nf.suggestions}</h2>
            <ul className="flex flex-wrap gap-1.5">
              {suggestions.symbol ? (
                <li>
                  <Link href={stockPath(suggestions.symbol)} className={chipClass}>
                    {tpl(nf.openSymbol, { symbol: suggestions.symbol })}
                  </Link>
                </li>
              ) : null}
              {suggestions.functions.map((match) => (
                <li key={match.fn.labelKey}>
                  <Link href={match.href} className={chipClass}>
                    <CodeChip code={match.fn.code} />
                    {t.help.functions[match.fn.labelKey].label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
