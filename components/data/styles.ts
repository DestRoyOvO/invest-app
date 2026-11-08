// Helpers shared by the data screens.

/** Focuses an element after React has rendered it again (a button that comes back when a confirmation is cancelled). */
export function focusSoon(ref: { readonly current: HTMLElement | null }): void {
  window.setTimeout(() => ref.current?.focus(), 0);
}
