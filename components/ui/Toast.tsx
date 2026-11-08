"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { useT } from "@/components/providers/PrefsProvider";
import { cn } from "@/lib/cn";

import { IconButton } from "./Button";
import { activeOutlet, addOutlet, carryOver, createToastStore, removeOutlet } from "./toast-queue";

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
  "pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center px-4 md:inset-x-auto md:right-4 md:bottom-10 md:items-end md:px-0";

/**
 * The toasts in an open dialog's outlet: a strip of the dialog's own layout, so they take room from its content instead
 * of covering it. Without toasts it has no height.
 */
export function dockedRegionClass(count: number): string {
  return cn("flex flex-col px-3", count > 0 && "py-2");
}

/**
 * A stack of toasts in a host: the toasts carried in from another host, then the live stack of those first shown
 * here. Cards sit 8px apart, and the live stack keeps 8px from a carried stack above it.
 */
export function stackClass(docked: boolean, spaced = false): string {
  return cn(docked ? "flex flex-col gap-2" : "flex w-full flex-col items-center gap-2 md:items-end", spaced && "mt-2");
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

type ShownToast = ToastOptions & { id: string };

interface ToastCardProps {
  toast: ShownToast;
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

interface ToastStacksProps {
  /** In a dialog's outlet, or at the screen's edge. */
  docked: boolean;
  /** Whether this host shows the toasts now. */
  active: boolean;
  /** Toasts carried in from another host, where a live region already showed them. */
  carried: readonly ShownToast[];
  /** Toasts first shown here. */
  fresh: readonly ShownToast[];
  liveRef?: Ref<HTMLDivElement>;
  closeLabel: string;
  onDismiss: (id: string) => void;
}

/**
 * One host's toasts: those carried in from another host (oldest, so first), outside the live region, so they are not
 * announced again; then the polite live region with the toasts first shown here. A host that shows no toasts keeps
 * its live region, empty: a toast that lands there later goes into a region that already exists, which is what gets
 * it announced.
 */
export function ToastStacks({ docked, active, carried, fresh, liveRef, closeLabel, onDismiss }: ToastStacksProps) {
  const cards = (list: readonly ShownToast[]) =>
    list.map((toast) => <ToastCard key={toast.id} toast={toast} docked={docked} closeLabel={closeLabel} onDismiss={onDismiss} />);
  return (
    <>
      {active && carried.length > 0 ? <div className={stackClass(docked)}>{cards(carried)}</div> : null}
      <div ref={liveRef} aria-live="polite" className={stackClass(docked, active && carried.length > 0 && fresh.length > 0)}>
        {active ? cards(fresh) : null}
      </div>
    </>
  );
}

/**
 * Hosts the toasts, announced through a polite live region: at the screen's edge (bottom center on phones above the tab
 * bar, bottom right on wider screens), or, while a modal layer is open, in that layer's ToastOutlet. A toast is
 * announced once, where it first shows; toasts that move with a layer opening or closing sit beside the live region of
 * their new host, so they are not announced again. Countdowns pause while the pointer is over the toasts or keyboard
 * focus is inside them. When a toast that has keyboard focus closes, focus moves to the toast that took its place, or
 * back to where it was before the toasts. Mounted once in components/providers/Providers.tsx.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  // The list and its countdowns live in one store that hands each new list to React.
  const [store] = useState(() => createToastStore<ToastEntry>(setToasts, { max: MAX_TOASTS }));
  const [outlets, setOutlets] = useState<readonly HTMLElement[]>([]);
  const outlet = activeOutlet(outlets);
  // Toasts a live region has shown (they were in a live stack in the document after a commit), and the ones carried to
  // another host since, which stay out of its live stack. A toast shown again is a new entry and is announced again.
  const announced = useRef(new WeakSet<ToastEntry>());
  const [carried, setCarried] = useState<ReadonlySet<ToastEntry>>(() => new Set());
  // The hosts (screen's edge, outlet) and their live stacks. The edge's live stack stays mounted while an outlet hosts
  // the toasts: a toast shown as a dialog closes (Save, Delete) then lands in a live region that already existed, which
  // is what gets it announced.
  const edgeRef = useRef<HTMLDivElement>(null);
  const dockedRef = useRef<HTMLDivElement>(null);
  const edgeLiveRef = useRef<HTMLDivElement>(null);
  const dockedLiveRef = useRef<HTMLDivElement>(null);
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

  // The host changes: the toasts already announced by then move along without being announced again.
  const carry = useCallback(() => {
    const onScreen = store.toasts();
    const shown = new Set(onScreen.filter((toast) => announced.current.has(toast)));
    setCarried((before) => carryOver(onScreen, (toast) => shown.has(toast), before));
  }, [store]);

  const registerOutlet = useCallback(
    (element: HTMLElement) => {
      carry();
      setOutlets((list) => addOutlet(list, element));
      return () => {
        carry();
        setOutlets((list) => removeOutlet(list, element));
      };
    },
    [carry],
  );

  useLayoutEffect(() => {
    // A toast counts as announced once it is in a live stack that is in the document. One rendered into the outlet of a
    // dialog that closes in the same commit is not: it is announced at the screen's edge on the next render.
    const live = outlet ? dockedLiveRef.current : edgeLiveRef.current;
    if (!live?.isConnected) return;
    for (const toast of toasts) if (!carried.has(toast)) announced.current.add(toast);
  }, [toasts, carried, outlet]);

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

  const region = { onPointerEnter, onPointerLeave, onFocus, onBlur };
  const moved = toasts.filter((toast) => carried.has(toast));
  const fresh = toasts.filter((toast) => !carried.has(toast));
  const stacks = { carried: moved, fresh, closeLabel: t.common.close, onDismiss: dismiss };

  return (
    <ToastContext value={api}>
      <ToastOutletContext value={registerOutlet}>
        {children}
        <div ref={edgeRef} {...region} className={EDGE_REGION}>
          <ToastStacks docked={false} active={outlet === null} liveRef={edgeLiveRef} {...stacks} />
        </div>
        {outlet
          ? createPortal(
              <div ref={dockedRef} {...region} className={dockedRegionClass(toasts.length)}>
                <ToastStacks docked active liveRef={dockedLiveRef} {...stacks} />
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
