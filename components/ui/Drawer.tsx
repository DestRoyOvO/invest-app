"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";

import { IconButton } from "./Button";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** Right-side modal panel: focus moves inside on open, Tab is trapped, Escape closes, focus returns on close. */
export function Drawer({ open, onClose, title, children, footer, widthClassName = "sm:w-[460px]" }: DrawerProps) {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Parents usually pass an inline onClose. Reading it through an effect event keeps the open effect from re-running
  // on every parent render, which would move focus back to the first field while the user is typing.
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("relative flex h-full w-full flex-col border-l border-line bg-panel shadow-2xl", widthClassName)}
      >
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
          <h2 id={titleId} className="label truncate">
            {title}
          </h2>
          <IconButton label={t.common.close} icon={<X className="size-4" strokeWidth={1.75} />} onClick={onClose} size="sm" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line">{footer}</div> : null}
      </div>
    </div>
  );
}
