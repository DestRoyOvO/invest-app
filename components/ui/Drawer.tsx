"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";

import { IconButton } from "./Button";
import { ToastOutlet } from "./Toast";

export type DrawerSide = "right" | "bottom" | "auto";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** right: side panel; bottom: sheet from the bottom edge; auto: a bottom sheet on phones, a side panel from sm up. */
  side?: DrawerSide;
  /** Width of the side panel from the sm breakpoint. */
  widthClassName?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

const CONTAINER: Record<DrawerSide, string> = {
  right: "justify-end",
  bottom: "items-end",
  auto: "items-end sm:items-stretch sm:justify-end",
};

// A sheet with toasts in it may grow past 85dvh, so the toasts take room from the backdrop rather than from its content.
const SHEET = "max-h-[85dvh] rounded-t-sm border-t pb-[env(safe-area-inset-bottom)]";
const PANEL: Record<DrawerSide, string> = {
  right: "h-full border-l",
  bottom: `${SHEET} has-[[data-toast]]:max-h-[calc(100dvh-2.75rem)]`,
  auto: `${SHEET} max-sm:has-[[data-toast]]:max-h-[calc(100dvh-2.75rem)] sm:h-full sm:max-h-none sm:rounded-none sm:border-t-0 sm:border-l sm:pb-0`,
};

// Where the toasts show while the drawer is open, in a strip of their own. In a side panel the strip sits between the
// content and the footer: the content gives up the room and nothing moves. In a sheet, which grows upward, it comes
// first (visually only; it stays after the content in the reading and Tab order), so nothing in the sheet moves either.
const OUTLET: Record<DrawerSide, string> = {
  right: "shrink-0 border-line has-[[data-toast]]:border-t",
  bottom: "order-first shrink-0 border-line has-[[data-toast]]:border-b",
  auto: "shrink-0 border-line max-sm:order-first max-sm:has-[[data-toast]]:border-b sm:has-[[data-toast]]:border-t",
};

/**
 * Modal side panel or bottom sheet: focus moves inside on open, Tab is trapped, Escape closes, focus returns on close.
 * While it is open the toasts show inside it (ToastOutlet), where they stay operable and announced and cover nothing.
 */
export function Drawer({ open, onClose, title, children, footer, side = "right", widthClassName = "sm:w-[460px]" }: DrawerProps) {
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
    <div className={cn("fixed inset-0 z-50 flex", CONTAINER[side])}>
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("relative flex w-full flex-col border-line bg-panel shadow-2xl", PANEL[side], side !== "bottom" && widthClassName)}
      >
        {/* A div, not a <header>: inside role=dialog a header is a second banner landmark next to the top bar's. */}
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel-2 px-3">
          <h2 id={titleId} className="panel-title truncate">
            {title}
          </h2>
          <IconButton label={t.common.close} icon={<X className="size-4" strokeWidth={1.75} />} onClick={onClose} size="sm" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <ToastOutlet className={OUTLET[side]} />
        {footer ? <div className="shrink-0 border-t border-line">{footer}</div> : null}
      </div>
    </div>
  );
}
