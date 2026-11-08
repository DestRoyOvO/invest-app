"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";

import { IconButton } from "./Button";
import { ToastOutlet, type ToastOutletWatch } from "./Toast";

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

// A sheet with toasts in it may grow past 85dvh, so the toasts take room from the backdrop. Once it reaches its limit
// (2.75rem below the top) they take it from the content, which the content keeper scrolls to keep in place.
const SHEET = "max-h-[85dvh] rounded-t-sm border-t pb-[env(safe-area-inset-bottom)]";
const PANEL: Record<DrawerSide, string> = {
  right: "h-full border-l",
  bottom: `${SHEET} has-[[data-toast]]:max-h-[calc(100dvh-2.75rem)]`,
  auto: `${SHEET} max-sm:has-[[data-toast]]:max-h-[calc(100dvh-2.75rem)] sm:h-full sm:max-h-none sm:rounded-none sm:border-t-0 sm:border-l sm:pb-0`,
};

// Where the toasts show while the drawer is open, in a strip of their own. In a side panel the strip sits between the
// content and the footer, and the content gives up the room at its bottom edge. In a sheet, which grows upward, it
// comes first (visually only; it stays after the content in the reading and Tab order), so the sheet's content and
// footer stay where they are.
const OUTLET: Record<DrawerSide, string> = {
  right: "shrink-0 border-line has-[[data-toast]]:border-t",
  bottom: "order-first shrink-0 border-line has-[[data-toast]]:border-b",
  auto: "shrink-0 border-line max-sm:order-first max-sm:has-[[data-toast]]:border-b sm:has-[[data-toast]]:border-t",
};

/** The drawer's scrolling content: its scroll offset and the top of its visible area on screen. */
export interface ContentPlace {
  scrollTop: number;
  top: number;
}

/**
 * The scroll offset that keeps the drawer's content where it was on screen after the strip of toasts changed size.
 *
 * In a side panel the strip sits below the content, whose top edge stays put: nothing needs to scroll. In a sheet at
 * its height limit the strip sits above the content, so a toast that comes moves the content's top edge down and one
 * that goes moves it up; scrolling by as much keeps what is on screen in place. Room given back while scrolled near
 * the end has partly been taken up already, by the browser pulling the offset back to the end of the range, so that
 * case counts from the offset before the change.
 */
export function keptScrollTop(before: ContentPlace, now: ContentPlace, maxScroll: number): number {
  const shift = now.top - before.top;
  const from = shift < 0 && now.scrollTop >= maxScroll - 1 ? before.scrollTop : now.scrollTop;
  return Math.min(Math.max(from + shift, 0), Math.max(maxScroll, 0));
}

/** A focused control and the scrolling area that clips it, as their top and bottom edges on screen. */
export interface FocusPlace {
  top: number;
  bottom: number;
  areaTop: number;
  areaBottom: number;
}

/**
 * How far to scroll the area around the focused control after the strip of toasts took room from it: a control that
 * was in full view and no longer is comes back by the shortest way (its top edge first, for a control taller than the
 * area). One that was already out of view is left alone, so a reader who scrolled away stays where they are.
 */
export function revealBy(before: FocusPlace, now: FocusPlace): number {
  const inView = (place: FocusPlace) => place.top >= place.areaTop - 1 && place.bottom <= place.areaBottom + 1;
  if (!inView(before) || inView(now)) return 0;
  if (now.top < now.areaTop) return now.top - now.areaTop;
  return Math.min(now.bottom - now.areaBottom, now.top - now.areaTop);
}

/** The area that clips an element in the drawer's content: its nearest ancestor that scrolls vertically, or the content. */
function scrollAreaOf(element: Element, content: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node && node !== content; node = node.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return node;
  }
  return content;
}

/** The drawer's scrolling content, beside the outlet in the dialog. */
function contentBeside(outlet: HTMLElement): HTMLElement | null {
  return outlet.parentElement?.querySelector<HTMLElement>(":scope > [data-drawer-content]") ?? null;
}

function contentPlace(content: HTMLElement): ContentPlace {
  return { scrollTop: content.scrollTop, top: content.getBoundingClientRect().top + content.clientTop };
}

function focusIn(content: HTMLElement): { element: Element; area: HTMLElement; place: FocusPlace } | null {
  const element = document.activeElement;
  if (!element || element === content || !content.contains(element)) return null;
  const area = scrollAreaOf(element, content);
  const box = element.getBoundingClientRect();
  const areaTop = area.getBoundingClientRect().top + area.clientTop;
  return { element, area, place: { top: box.top, bottom: box.bottom, areaTop, areaBottom: areaTop + area.clientHeight } };
}

/**
 * Keeps a drawer's content in place while the toasts in its strip come and go (the ToastOutlet's watch): `before`
 * notes where the content (`data-drawer-content`, beside the outlet) and the focused control are, `after` scrolls the
 * content back by as much as the strip moved it (keptScrollTop) and brings the focused control back into view if the
 * strip took the room where it sat (revealBy).
 */
export function createContentKeeper(): ToastOutletWatch {
  let noted: { place: ContentPlace; focus: ReturnType<typeof focusIn> } | null = null;
  return {
    before(outlet) {
      const content = contentBeside(outlet);
      noted = content ? { place: contentPlace(content), focus: focusIn(content) } : null;
    },
    after(outlet) {
      const was = noted;
      noted = null;
      const content = contentBeside(outlet);
      if (!content || !was) return;
      const next = keptScrollTop(was.place, contentPlace(content), content.scrollHeight - content.clientHeight);
      if (Math.abs(next - content.scrollTop) >= 0.5) content.scrollTop = next;
      if (!was.focus || document.activeElement !== was.focus.element) return;
      const focus = focusIn(content);
      if (!focus || focus.area !== was.focus.area) return;
      const by = revealBy(was.focus.place, focus.place);
      if (by !== 0) focus.area.scrollTop += by;
    },
  };
}

/**
 * Modal side panel or bottom sheet: focus moves inside on open, Tab is trapped, Escape closes, focus returns on close.
 * While it is open the toasts show inside it (ToastOutlet), where they stay operable and announced and cover nothing,
 * and the content stays where it is on screen as they come and go.
 */
export function Drawer({ open, onClose, title, children, footer, side = "right", widthClassName = "sm:w-[460px]" }: DrawerProps) {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [keeper] = useState(createContentKeeper);
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
        <div data-drawer-content className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
        <ToastOutlet className={OUTLET[side]} watch={keeper} />
        {footer ? <div className="shrink-0 border-t border-line">{footer}</div> : null}
      </div>
    </div>
  );
}
