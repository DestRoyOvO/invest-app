"use client";

import Link from "next/link";
import { Fragment, useId, useSyncExternalStore, type ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Kbd } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { cn } from "@/lib/cn";
import { FUNCTIONS, shortcutKeys } from "@/lib/functions";
import { hotkeyKeys, useActiveHotkeys } from "@/hooks/useHotkeys";

import { CodeChip } from "./CodeChip";

const noopSubscribe = () => () => {};

/** Mac keyboards say Cmd where others say Ctrl; false during server rendering. */
function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), () => false);
}

function Keys({ keys, joiner }: { keys: string[]; joiner?: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, i) => (
        <Fragment key={`${key}-${i}`}>
          {i > 0 && joiner ? <span className="text-xs text-fg-3">{joiner}</span> : null}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}

function Row({ keys, children, className }: { keys: ReactNode; children: ReactNode; className?: string }) {
  return (
    <li className={cn("flex min-h-8 items-center justify-between gap-3 py-1 text-sm", className)}>
      <span className="min-w-0 text-fg-2">{children}</span>
      {keys}
    </li>
  );
}

/** True when the query (lowercase) appears in any of the texts. */
function hit(query: string, ...texts: string[]): boolean {
  return !query || texts.some((text) => text.toLowerCase().includes(query));
}

/**
 * The keyboard reference: global keys, the "g" sequences of every function and, when `pageKeys` is set, the keys the
 * current page registered through useHotkeys. Shared by the "?" sheet and /help (which filters it with `query`).
 */
export function ShortcutList({ query = "", pageKeys = true, onNavigate }: { query?: string; pageKeys?: boolean; onNavigate?: () => void }) {
  const t = useT();
  const s = t.help.shortcuts;
  const isMac = useIsMac();
  const active = useActiveHotkeys();
  const q = query.trim().toLowerCase();

  const globals = [
    {
      keys: (
        <span className="flex shrink-0 items-center gap-1">
          <Kbd>/</Kbd>
          <span className="text-xs text-fg-3">{s.or}</span>
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      ),
      text: s.command,
      extra: ["/", "ctrl", "cmd", "k"],
    },
    { keys: <Keys keys={["?"]} />, text: s.shortcuts, extra: ["?"] },
    { keys: <Keys keys={["Esc"]} />, text: s.close, extra: ["esc", "escape"] },
    { keys: <Keys keys={["↑", "↓"]} />, text: s.paletteMove, extra: ["arrow"] },
  ].filter((row) => hit(q, row.text, ...row.extra));

  const go = FUNCTIONS.filter((fn) => fn.shortcut).filter((fn) => {
    const label = t.help.functions[fn.labelKey].label;
    return hit(q, label, fn.code, fn.shortcut ?? "", s.goTo);
  });

  const page = active.filter((hotkey) => hit(q, hotkey.description, hotkey.key));
  // Each list is named by its heading, so "This page" and the others can be told apart without reading around them.
  const id = useId();

  return (
    <div className="@container space-y-4">
      {globals.length > 0 ? (
        <section>
          <h3 id={`${id}-global`} className="col-head pb-1">
            {s.global}
          </h3>
          <ul aria-labelledby={`${id}-global`} className="divide-y divide-line">
            {globals.map((row, i) => (
              <Row key={i} keys={row.keys}>
                {row.text}
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      {go.length > 0 ? (
        <section>
          <h3 id={`${id}-go`} className="col-head pb-1">
            {s.goTo} <span className="normal-case">· {s.goHint}</span>
          </h3>
          <ul aria-labelledby={`${id}-go`} className="grid grid-cols-1 gap-x-6 @md:grid-cols-2">
            {go.map((fn) => (
              <Row key={fn.labelKey} keys={<Keys keys={shortcutKeys(fn.shortcut)} />} className="border-b border-line">
                <span className="flex min-w-0 items-center gap-2">
                  <CodeChip code={fn.code} decorative />
                  <span className="truncate">{t.help.functions[fn.labelKey].label}</span>
                </span>
              </Row>
            ))}
          </ul>
        </section>
      ) : null}

      {pageKeys ? (
        <section>
          <h3 id={`${id}-page`} className="col-head pb-1">
            {s.page}
          </h3>
          {page.length > 0 ? (
            <ul aria-labelledby={`${id}-page`} className="divide-y divide-line">
              {page.map((hotkey) => (
                <Row key={`${hotkey.alt ? "alt+" : ""}${hotkey.key}`} keys={<Keys keys={hotkeyKeys(hotkey)} />}>
                  {hotkey.description}
                </Row>
              ))}
            </ul>
          ) : (
            <p className="py-1 text-sm text-fg-3">{s.pageNone}</p>
          )}
        </section>
      ) : null}

      <p className="text-xs text-fg-3">{s.note}</p>
      {onNavigate ? (
        <Link href="/help" onClick={onNavigate} className="inline-block text-sm text-info hover:underline">
          {s.allFunctions}
        </Link>
      ) : null}
    </div>
  );
}

/** The "?" sheet: a side panel on wide screens, a bottom sheet on phones. Mounted once in the shell. */
export function ShortcutsSheet() {
  const t = useT();
  const { shortcutsOpen, closeShortcuts } = useUi();
  return (
    <Drawer open={shortcutsOpen} onClose={closeShortcuts} title={t.help.shortcuts.title} side="auto" widthClassName="sm:w-[540px]">
      <div className="p-3">
        <ShortcutList onNavigate={closeShortcuts} />
      </div>
    </Drawer>
  );
}
