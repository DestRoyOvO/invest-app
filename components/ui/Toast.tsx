"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";

import { IconButton } from "./Button";
import { createToastStore } from "./toast-queue";

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

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Hosts the toasts (bottom center on phones above the tab bar, bottom right on wider screens) in a polite live region.
 * Countdowns pause while the pointer is over the toasts or keyboard focus is inside them. When a toast that has
 * keyboard focus closes, focus moves to the toast that took its place, or back to where it was before the toasts.
 * Mounted once in components/providers/Providers.tsx.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  // The list and its countdowns live in one store that hands each new list to React.
  const [store] = useState(() => createToastStore<ToastEntry>(setToasts, { max: MAX_TOASTS }));
  const regionRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    // The focusout of a toast that closes under keyboard focus fires while React deletes it and never reaches onBlur,
    // and a pointer can be left over the gap it leaves. So the holds are checked after every change; otherwise the
    // countdowns would stay paused and later toasts would never close by themselves.
    const region = regionRef.current;
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
  }, [toasts, store]);

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

  return (
    <ToastContext value={api}>
      {children}
      <div
        ref={regionRef}
        aria-live="polite"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        className="pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-4 md:bottom-10 md:items-end md:px-0"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-toast
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xs border border-line-2 bg-panel-2 py-1.5 pr-1.5 pl-3 text-sm text-fg shadow-xl md:w-auto md:min-w-72"
          >
            <div className="min-w-0 flex-1">{toast.message}</div>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onAction();
                  dismiss(toast.id);
                }}
                className="h-7 shrink-0 rounded-xs px-2 text-sm font-medium text-accent transition-colors hover:bg-hover max-sm:h-10"
              >
                {toast.action.label}
              </button>
            ) : null}
            <IconButton size="sm" label={t.common.close} icon={<X className="size-3.5" strokeWidth={1.75} />} onClick={() => dismiss(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

/** Shows short confirmations with an optional Undo, e.g. `toast.show({ message: "Removed NVDA", action: { label: "Undo", onAction } })`. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
