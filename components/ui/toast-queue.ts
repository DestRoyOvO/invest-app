// Queue, timer and outlet rules for Toast, kept free of React so they can be tested.

export interface QueuedToast {
  id: string;
}

/** Appends a toast (replacing one with the same id) and keeps the newest `max`, so a burst never floods the screen. */
export function pushToast<T extends QueuedToast>(queue: readonly T[], toast: T, max: number): T[] {
  const next = [...queue.filter((item) => item.id !== toast.id), toast];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function removeToast<T extends QueuedToast>(queue: readonly T[], id: string): T[] {
  return queue.filter((item) => item.id !== id);
}

/**
 * Time left before a toast closes when its timer resumes after a pause (hover or focus). It never drops below
 * `floor`, so a toast left the moment before it expired still gives the reader a moment to act.
 */
export function remainingTime(deadline: number, now: number, floor = 1500): number {
  return Math.max(deadline - now, floor);
}

/** What pauses the countdowns: the pointer over the toasts, or keyboard focus inside them. */
export type ToastHold = "hover" | "focus";

export interface TimedToast extends QueuedToast {
  /** Auto-dismiss delay in ms. */
  duration: number;
}

export interface ToastStore<T extends TimedToast> {
  /** Adds a toast (replacing one with the same id), drops the oldest beyond the limit and starts its countdown. */
  show: (toast: T) => void;
  /** Closes a toast now. */
  dismiss: (id: string) => void;
  /**
   * Turns one hold on or off. Every countdown pauses while any hold is on and resumes with the time it had left (at
   * least the floor) once none is. Hover and focus are tracked apart, so leaving with the pointer while focus is still
   * inside does not restart the countdowns.
   */
  hold: (reason: ToastHold, on: boolean) => void;
  /** Whether this hold (or, without an argument, any hold) is on. */
  isHeld: (reason?: ToastHold) => boolean;
  /** The toasts on screen, oldest first. */
  toasts: () => readonly T[];
  /** Cancels every countdown and hold (on unmount). The toasts stay as they are. */
  clear: () => void;
}

interface Countdown {
  handle: ReturnType<typeof setTimeout> | undefined;
  deadline: number;
  /** Time left when the countdown paused (its full duration if it started paused). */
  left: number;
}

/**
 * The toast stack with its auto-dismiss countdowns. `onChange` receives every new list (the React state setter). The
 * list and the countdowns change together, so a toast pushed out by a newer one never keeps a countdown, and a toast
 * shown before the previous one rendered never loses its own.
 */
export function createToastStore<T extends TimedToast>(onChange: (toasts: T[]) => void, { max = 3, floor = 1500 } = {}): ToastStore<T> {
  let queue: T[] = [];
  const countdowns = new Map<string, Countdown>();
  const holds = new Set<ToastHold>();

  const publish = (next: T[]) => {
    queue = next;
    onChange(next);
  };

  const halt = (countdown: Countdown) => {
    if (countdown.handle !== undefined) clearTimeout(countdown.handle);
    countdown.handle = undefined;
  };

  const stop = (id: string) => {
    const countdown = countdowns.get(id);
    if (countdown) halt(countdown);
    countdowns.delete(id);
  };

  const run = (id: string, countdown: Countdown, ms: number) => {
    countdown.deadline = Date.now() + ms;
    countdown.handle = setTimeout(() => {
      countdowns.delete(id);
      publish(removeToast(queue, id));
    }, ms);
  };

  return {
    show(toast) {
      const next = pushToast(queue, toast, max);
      for (const old of queue) {
        if (!next.some((item) => item.id === old.id)) stop(old.id);
      }
      stop(toast.id);
      const countdown: Countdown = { handle: undefined, deadline: Date.now() + toast.duration, left: toast.duration };
      countdowns.set(toast.id, countdown);
      if (holds.size === 0) run(toast.id, countdown, toast.duration);
      publish(next);
    },
    dismiss(id) {
      stop(id);
      if (queue.some((item) => item.id === id)) publish(removeToast(queue, id));
    },
    hold(reason, on) {
      const wasHeld = holds.size > 0;
      if (on) holds.add(reason);
      else holds.delete(reason);
      const held = holds.size > 0;
      if (held === wasHeld) return;
      if (held) {
        const now = Date.now();
        for (const countdown of countdowns.values()) {
          halt(countdown);
          countdown.left = remainingTime(countdown.deadline, now, floor);
        }
      } else {
        for (const [id, countdown] of countdowns) run(id, countdown, countdown.left);
      }
    },
    isHeld(reason) {
      return reason ? holds.has(reason) : holds.size > 0;
    },
    toasts() {
      return queue;
    },
    clear() {
      for (const countdown of countdowns.values()) halt(countdown);
      countdowns.clear();
      holds.clear();
    },
  };
}

/**
 * The outlets that can host the toasts while a modal layer is open (every open Drawer has one), oldest first. The
 * newest one hosts them; when it goes, the one below takes over, and with none left the toasts return to the screen's
 * edge. Registering an outlet again moves it to the top.
 */
export function addOutlet<T>(outlets: readonly T[], outlet: T): readonly T[] {
  return [...outlets.filter((item) => item !== outlet), outlet];
}

/** Drops an outlet; the same list when it was not registered, so a state setter skips the render. */
export function removeOutlet<T>(outlets: readonly T[], outlet: T): readonly T[] {
  return outlets.includes(outlet) ? outlets.filter((item) => item !== outlet) : outlets;
}

/** The outlet that hosts the toasts: the newest, or null for the screen's edge. */
export function activeOutlet<T>(outlets: readonly T[]): T | null {
  return outlets.length > 0 ? outlets[outlets.length - 1] : null;
}

/**
 * The toasts that move to another host without being announced again, worked out as the host changes (a drawer opens
 * or closes): every toast on screen that a live region has already shown, besides those carried before. A toast shown
 * in the same moment, such as the confirmation of a drawer's Save as it closes, has not been shown in a live region
 * yet, so it stays out and gets announced in its new host. Toasts no longer on screen drop out.
 */
export function carryOver<T>(onScreen: readonly T[], announced: (toast: T) => boolean, carried: ReadonlySet<T>): ReadonlySet<T> {
  const next = new Set<T>();
  for (const toast of onScreen) if (carried.has(toast) || announced(toast)) next.add(toast);
  return next;
}
