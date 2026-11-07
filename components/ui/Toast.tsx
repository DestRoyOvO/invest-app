"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useT } from "@/components/providers/PrefsProvider";

import { IconButton } from "./Button";
import { pushToast, remainingTime, removeToast } from "./toast-queue";

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
 * Mounted once in components/providers/Providers.tsx.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, { handle: number; deadline: number }>());
  const paused = useRef(false);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer.handle);
    timers.current.delete(id);
    setToasts((queue) => removeToast(queue, id));
  }, []);

  const schedule = useCallback(
    (id: string, ms: number) => {
      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing.handle);
      const handle = window.setTimeout(() => dismiss(id), ms);
      timers.current.set(id, { handle, deadline: Date.now() + ms });
    },
    [dismiss],
  );

  const show = useCallback(
    (options: ToastOptions) => {
      counter.current += 1;
      const id = options.id ?? `toast-${counter.current}`;
      const duration = options.duration ?? (options.action ? 8000 : 5000);
      setToasts((queue) => pushToast(queue, { ...options, id, duration }, MAX_TOASTS));
      if (!paused.current) schedule(id, duration);
      else timers.current.set(id, { handle: 0, deadline: Date.now() + duration });
      return id;
    },
    [schedule],
  );

  // Toasts pushed out of the queue by newer ones must not keep a timer.
  useEffect(() => {
    for (const id of [...timers.current.keys()]) {
      if (!toasts.some((toast) => toast.id === id)) {
        window.clearTimeout(timers.current.get(id)?.handle);
        timers.current.delete(id);
      }
    }
  }, [toasts]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer.handle);
    };
  }, []);

  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    for (const timer of timers.current.values()) window.clearTimeout(timer.handle);
  };
  const resume = () => {
    if (!paused.current) return;
    paused.current = false;
    const now = Date.now();
    for (const [id, timer] of timers.current) schedule(id, remainingTime(timer.deadline, now));
  };

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={resume}
        className="pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-4 md:bottom-10 md:items-end md:px-0"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
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
