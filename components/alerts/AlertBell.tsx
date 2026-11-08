"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { useAlertLog, useAlertRules } from "@/hooks/useAlerts";
import { useHydrated } from "@/hooks/useLocalValue";
import { useNow } from "@/hooks/useNotes";
import { markAlertEventsSeen, unseenCount } from "@/lib/alerts";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatRelativeTime, tpl } from "@/lib/format";

import { describeAlertEvent } from "./describe";

const RECENT = 8;

const linkButton =
  "inline-flex h-7 shrink-0 items-center rounded-xs border border-line-2 bg-panel-2 px-2 text-xs font-medium text-fg transition-colors hover:bg-hover max-sm:h-10 max-sm:px-3";

/** Top-bar entry to the alert center: the count of unseen triggers and a popover with the latest ones. */
export function AlertBell() {
  const { t, lang } = usePrefs();
  const { openAlertEditor } = useUi();
  const log = useAlertLog();
  const rules = useAlertRules();
  const hydrated = useHydrated();
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const unseen = hydrated ? unseenCount(log) : 0;
  const recent = log.slice(0, RECENT);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        ref={buttonRef}
        label={unseen > 0 ? tpl(t.alerts.bell.unseen, { n: unseen }) : t.alerts.bell.label}
        icon={<Bell className="size-4" strokeWidth={1.75} />}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        active={open}
        onClick={() => setOpen((value) => !value)}
      />
      {unseen > 0 ? (
        <span
          aria-hidden
          className="num pointer-events-none absolute top-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] leading-none font-semibold text-accent-fg max-sm:top-0.5 max-sm:right-0.5"
        >
          {unseen > 9 ? "9+" : unseen}
        </span>
      ) : null}
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t.alerts.bell.center}
          className="fixed inset-x-2 top-12 z-50 flex max-h-[calc(100dvh-4rem)] flex-col rounded-xs border border-line-2 bg-panel shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96"
        >
          <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel-2 px-3">
            <h2 className="panel-title">{t.alerts.bell.center}</h2>
            {unseen > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => markAlertEventsSeen()}>
                {t.alerts.bell.markAllSeen}
              </Button>
            ) : null}
          </div>
          {recent.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-2">{rules.length === 0 ? t.alerts.bell.noRules : t.alerts.bell.noEvents}</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {recent.map((event) => (
                <li key={event.id} className="border-b border-line/70 last:border-b-0">
                  <Link
                    href={stockPath(event.symbol)}
                    onClick={() => {
                      markAlertEventsSeen([event.id]);
                      setOpen(false);
                    }}
                    className="flex gap-2.5 px-3 py-2 transition-colors hover:bg-hover focus-visible:outline-offset-[-2px]"
                  >
                    <span aria-hidden className={cn("mt-[0.45rem] size-1.5 shrink-0 rounded-full", event.seen ? "bg-line-2" : "bg-accent")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", event.seen ? "text-fg-2" : "text-fg")}>
                        {event.seen ? null : <span className="sr-only">{t.alerts.bell.unseenItem}: </span>}
                        {describeAlertEvent(event, t, lang, "log")}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-fg-3">
                        <span className="num shrink-0">{formatRelativeTime(event.at, lang, now?.getTime() ?? Date.parse(event.at))}</span>
                        {event.missed ? <Badge>{t.alerts.event.missedBadge}</Badge> : null}
                        {event.note ? <span className="truncate">{event.note}</span> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
            <span className="text-xs text-fg-3">{t.alerts.bell.checkedWhileOpen}</span>
            <span className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="max-sm:px-3"
                onClick={() => {
                  setOpen(false);
                  openAlertEditor();
                }}
              >
                {t.alerts.bell.newAlert}
              </Button>
              <Link href="/alerts" onClick={() => setOpen(false)} className={linkButton}>
                {t.alerts.bell.manage}
              </Link>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
