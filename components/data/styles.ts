// Class names shared by the data screens.

/** Text buttons grow to a 40px touch target below the sm breakpoint, as icon buttons and chips do. */
export const TOUCH = "max-sm:h-10";

/** Focuses an element after React has rendered it again (a button that comes back when a confirmation is cancelled). */
export function focusSoon(ref: { readonly current: HTMLElement | null }): void {
  window.setTimeout(() => ref.current?.focus(), 0);
}
