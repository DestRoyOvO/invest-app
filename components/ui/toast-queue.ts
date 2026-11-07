// Queue and timer rules for Toast, kept free of React so they can be tested.

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
