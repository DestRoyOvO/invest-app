"use client";

import { useEffect, useRef, type RefObject } from "react";

export type TickDirection = "up" | "down";

/** Flash duration; matches the flash-up and flash-down keyframes in app/globals.css. */
export const TICK_FLASH_MS = 600;

/** Direction of a value change between two refreshes, or null when it did not change or cannot be compared. */
export function tickDirection(previous: number | null | undefined, next: number | null | undefined): TickDirection | null {
  if (typeof previous !== "number" || typeof next !== "number" || !Number.isFinite(previous) || !Number.isFinite(next)) return null;
  if (next === previous) return null;
  return next > previous ? "up" : "down";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Flashes the element behind the returned ref for about 600ms when `value` changes between renders: green or red
 * (following the color convention) by direction. The first render never flashes, unchanged values never flash and
 * reduced motion turns it off. Works on the DOM directly, so a tick does not re-render anything.
 */
export function useTickFlash<T extends HTMLElement>(value: number | null | undefined): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const previous = useRef(value);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    const direction = tickDirection(before, value);
    const el = ref.current;
    if (!direction || !el || prefersReducedMotion()) return;
    const name = direction === "up" ? "flash-up" : "flash-down";
    el.classList.remove("flash-up", "flash-down");
    // Reading layout restarts the animation when the same direction repeats within the flash.
    void el.offsetWidth;
    el.classList.add(name);
    const done = () => el.classList.remove(name);
    const timer = window.setTimeout(done, TICK_FLASH_MS + 100);
    return () => window.clearTimeout(timer);
  }, [value]);

  return ref;
}
