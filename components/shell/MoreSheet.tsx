"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/providers/PrefsProvider";
import { Drawer } from "@/components/ui/Drawer";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { FUNCTION_GROUPS, FUNCTIONS, isFunctionActive } from "@/lib/functions";

import { BackupReminderItem } from "./BackupReminder";
import { CodeChip } from "./CodeChip";
import { navItem, type NavContext } from "./nav";

/**
 * The phone's More sheet: every function by group, code first. Symbol functions open the last viewed symbol, named under
 * the Research heading. DES is left out because it opens the same page as QT. While a backup is due, a row under DATA
 * says so, as the status bar does on larger screens.
 */
export function MoreSheet({ open, onClose, ctx }: { open: boolean; onClose: () => void; ctx: NavContext }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <Drawer open={open} onClose={onClose} title={t.nav.allFunctions} side="bottom">
      <div className="space-y-3 px-3 pt-2 pb-4">
        {FUNCTION_GROUPS.map((group) => {
          const items = FUNCTIONS.filter((fn) => fn.group === group && fn.labelKey !== "des").map((fn) => navItem(fn.labelKey, ctx));
          const headingId = `more-${group}`;
          return (
            <section key={group} aria-labelledby={headingId}>
              <h3 id={headingId} className="flex items-baseline gap-2 pb-1">
                <span className="col-head">{t.nav.groups[group]}</span>
                {group === "research" ? <span className="text-xs text-fg-3">{tpl(t.nav.symbolFunctions, { symbol: ctx.lastSymbol })}</span> : null}
              </h3>
              <ul className="grid grid-cols-2 gap-px bg-line p-px">
                {items.map(({ fn, href }) => {
                  const active = fn.scope === "global" && isFunctionActive(fn, pathname);
                  return (
                    <li key={fn.labelKey} className="bg-panel">
                      <Link
                        href={href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn("flex h-11 items-center gap-2 px-2.5 text-sm text-fg-2 transition-colors hover:bg-hover hover:text-fg", active && "bg-hover text-fg")}
                      >
                        <CodeChip code={fn.code} />
                        <span className="min-w-0 flex-1 truncate">{t.help.functions[fn.labelKey].label}</span>
                      </Link>
                    </li>
                  );
                })}
                {/* Fills the last row of an odd group, so the grid's hairline color does not show through. */}
                {items.length % 2 === 1 ? <li aria-hidden className="bg-panel" /> : null}
                {group === "tools" ? <BackupReminderItem onNavigate={onClose} /> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
