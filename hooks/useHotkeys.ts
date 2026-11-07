"use client";

import { useEffect, useEffectEvent } from "react";

// Page-level single-key shortcuts (the shell owns the global "/", Ctrl/Cmd+K and "g" sequences).
// Keys never fire while the user types in a field, during IME composition (Chinese input), with Ctrl, Cmd or Alt held
// (unless the hotkey asks for it), or while a modal dialog (command bar, drawer, editor) is open.

export interface Hotkey {
  /** KeyboardEvent.key, compared case-insensitively for letters, e.g. "a", "?", "ArrowDown", "1". */
  key: string;
  handler: (event: KeyboardEvent) => void;
  /** Shown in the shortcuts sheet. */
  description?: string;
  /** Require Alt (used for Alt+Arrow row moves). */
  alt?: boolean;
  /** Extra condition evaluated at key time. */
  when?: () => boolean;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** True when a key event matches a hotkey definition (exported for tests). */
export function matchesHotkey(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">, hotkey: Pick<Hotkey, "key" | "alt">): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  if (Boolean(hotkey.alt) !== event.altKey) return false;
  return event.key.length === 1 && hotkey.key.length === 1 ? event.key.toLowerCase() === hotkey.key.toLowerCase() : event.key === hotkey.key;
}

/** Registers single-key shortcuts while the calling component is mounted (and `enabled`). */
export function useHotkeys(hotkeys: readonly Hotkey[], enabled = true): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const hotkey = hotkeys.find((h) => matchesHotkey(event, h) && (h.when ? h.when() : true));
    if (!hotkey) return;
    event.preventDefault();
    hotkey.handler(event);
  });

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [enabled]);
}
