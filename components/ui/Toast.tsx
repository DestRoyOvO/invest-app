"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useT } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";

import { IconButton } from "./Button";
import { activeOutlet, addOutlet, createToastStore, removeOutlet } from "./toast-queue";

export interface ToastOptions {
  message: ReactNode;
  /** One follow-up action, typically Undo. Running it also closes the toast. */
  action?: { label: string; onAction: () => void };
  /** Auto-dismiss delay in ms (default 5000, 8000 with an action). Hovering or focusing the toasts pauses it. */
  duration?: number;
  /** Reusing an id replaces that toast instead of stacking a second one. */
  id?: string;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface ToastEntry extends ToastOptions {
  id: string;
  duration: number;
}

const MAX_TOASTS = 3;

/** The toasts at the screen's edge: bottom center on phones above the tab bar, bottom right from md above the status bar. */
const EDGE_REGION =
  "pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-4 md:bottom-10 md:items-end md:px-0";

/**
 * The toasts in an open dialog's outlet: a strip of the dialog's own layout, so they take room from its content instead
 * of covering it. Without toasts it has no height.
 */
export function dockedRegionClass(count: number): string {
  return cn("flex flex-col gap-2 px-3", count > 0 && "py-2");
}

/** A toast: at the screen's edge a card as wide as its text, with a shadow; in a dialog's outlet, as wide as the strip. */
export function toastCardClass(docked: boolean): string {
  return cn(
    "pointer-events-auto flex w-full items-center gap-3 rounded-xs border border-line-2 bg-panel-2 py-1.5 pr-1.5 pl-3 text-sm text-fg",
    !docked && "max-w-sm shadow-xl md:w-auto md:min-w-72",
  );
}

const ToastContext = createContext<ToastApi | null>(null);
/** Registers an outlet element and returns the function that removes it again. */
const ToastOutletContext = createContext<((element: HTMLElement) => () => void) | null>(null);

interface ToastCardProps {
  toast: ToastOptions & { id: string };
  docked: boolean;
  closeLabel: string;
  onDismiss: (id: string) => void;
}

/**
 * One toast: the message, its action and Close. The buttons are described by the message, so "Undo" and "Close" say
 * what they act on, also inside a dialog that has a Close button of its own.
 */
export function ToastCard({ toast, docked, closeLabel, onDismiss }: ToastCardProps) {
  const messageId = useId();
  return (
    <div data-toast className={toastCardClass(docked)}>
      <div id={messageId} className="min-w-0 flex-1">
        {toast.message}
      </div>
      {toast.action ? (
        <button
          type="button"
          aria-describedby={messageId}
          onClick={() => {
            toast.action?.onAction();
            onDismiss(toast.id);
          }}
          className="h-7 shrink-0 rounded-xs px-2 text-sm font-medium text-accent transition-colors hover:bg-hover max-sm:h-10"
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton size="sm" label={closeLabel} aria-describedby={messageId} icon={<X className="size-3.5" strokeWidth={1.75} />} onClick={() => onDismiss(toast.id)} />
    </div>
  );
}

/**
 * Hosts the toasts in a polite live region: at the screen's edge (bottom center on phones above the tab bar, bottom
 * right on wider screens), or, while a modal layer is open, in that layer's ToastOutlet. Countdowns pause while the
 * pointer is over the toasts or keyboard focus is inside them. When a toast that has keyboard focus closes, focus moves
 * to the toast that took its place, or back to where it was before the toasts. Mounted once in
 * components/providers/Providers.tsx.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  // The list and its countdowns live in one store that hands each new list to React.
  const [store] = useState(() => createToastStore<ToastEntry>(setToasts, { max: MAX_TOASTS }));
  const [outlets, setOutlets] = useState<readonly HTMLElement[]>([]);
  const outlet = activeOutlet(outlets);
  // The region at the screen's edge stays mounted while an outlet hosts the toasts: a toast shown as a dialog closes
  // (Save, Delete) then lands in a live region that already existed, which is what gets it announced.
  const edgeRef = useRef<HTMLDivElement>(null);
  const dockedRef = useRef<HTMLDivElement>(null);
  // Where keyboard focus came from before it entered the toasts, which toast holds it, and whether it got there by
  // keyboard: enough to put focus somewhere sensible when that toast closes under it.
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusedIndex = useRef(-1);
  const keyboardFocus = useRef(false);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => store.dismiss(id), [store]);

  const show = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = options.id ?? `toast-${counter.current}`;
      store.show({ ...options, id, duration: options.duration ?? (options.action ? 8000 : 5000) });
      return id;
    },
    [store],
  );

  const registerOutlet = useCallback((element: HTMLElement) => {
    setOutlets((list) => addOutlet(list, element));
    return () => setOutlets((list) => removeOutlet(list, element));
  }, []);

  useEffect(() => {
    // The focusout of a toast that closes under keyboard focus fires while React deletes it and never reaches onBlur,
    // and a pointer can be left over the gap it leaves. The same goes for toasts that move between the screen's edge
    // and an outlet. So the holds are checked after every change; otherwise the countdowns would stay paused and later
    // toasts would never close by themselves.
    const region = outlet ? dockedRef.current : edgeRef.current;
    if (!region) return;
    if (store.isHeld("focus") && !region.contains(document.activeElement)) {
      store.hold("focus", false);
      const active = document.activeElement;
      if (keyboardFocus.current && (!active || active === document.body)) {
        const items = region.querySelectorAll<HTMLElement>("[data-toast]");
        const next = items[Math.min(focusedIndex.current, items.length - 1)]?.querySelector<HTMLElement>("button");
        const back = returnFocus.current?.isConnected ? returnFocus.current : null;
        (next ?? back)?.focus();
      }
      if (!region.contains(document.activeElement)) {
        returnFocus.current = null;
        focusedIndex.current = -1;
      }
    }
    if (store.isHeld("hover") && !region.matches(":hover")) store.hold("hover", false);
  }, [toasts, store, outlet]);

  useEffect(() => () => store.clear(), [store]);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const region = event.currentTarget;
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !region.contains(from)) returnFocus.current = from;
    const target = event.target as HTMLElement;
    const item = target.closest("[data-toast]");
    focusedIndex.current = item ? Array.prototype.indexOf.call(region.querySelectorAll("[data-toast]"), item) : -1;
    keyboardFocus.current = target.matches(":focus-visible");
    store.hold("focus", true);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    // Moving between the buttons of the toasts keeps them paused.
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    returnFocus.current = null;
    focusedIndex.current = -1;
    store.hold("focus", false);
  };

  // A touch has no hover, and its emulated mouse events never leave, so only a real pointer pauses the toasts.
  const onPointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") store.hold("hover", true);
  };
  const onPointerLeave = () => store.hold("hover", false);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const region = { "aria-live": "polite", onPointerEnter, onPointerLeave, onFocus, onBlur } as const;
  const cards = (docked: boolean) => toasts.map((toast) => <ToastCard key={toast.id} toast={toast} docked={docked} closeLabel={t.common.close} onDismiss={dismiss} />);

  return (
    <ToastContext value={api}>
      <ToastOutletContext value={registerOutlet}>
        {children}
        <div ref={edgeRef} {...region} className={EDGE_REGION}>
          {outlet ? null : cards(false)}
        </div>
        {outlet
          ? createPortal(
              <div ref={dockedRef} {...region} className={dockedRegionClass(toasts.length)}>
                {cards(true)}
              </div>,
              outlet,
            )
          : null}
      </ToastOutletContext>
    </ToastContext>
  );
}

/**
 * Where the toasts show while a modal layer is open; Drawer renders one between its content and its footer. Inside the
 * dialog the toasts stay reachable with Tab and get announced (under aria-modal, assistive technology treats the rest
 * of the page as inert), and in a strip of their own they never cover the dialog's fields or buttons. The newest
 * outlet hosts the toasts; with none, they show at the screen's edge.
 */
export function ToastOutlet({ className }: { className?: string }) {
  const register = useContext(ToastOutletContext);
  const ref = useCallback((element: HTMLDivElement | null) => (element && register ? register(element) : undefined), [register]);
  return <div ref={ref} data-toast-outlet className={className} />;
}

/** Shows short confirmations with an optional Undo, e.g. `toast.show({ message: "Removed NVDA", action: { label: "Undo", onAction } })`. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
