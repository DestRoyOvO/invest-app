"use client";

import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

// Page-level single-key shortcuts (the shell owns the global "/", "?", Ctrl/Cmd+K and "g" sequences, so pages must not
// use those keys). Keys never fire while the user types in a field, during IME composition (Chinese input), with
// Ctrl, Cmd or Alt held (unless the hotkey asks for Alt), or while a dialog is open: modal ones (command bar, drawer,
// editor) and popovers such as the settings menu.
//
// Hotkeys with a description are also listed, while their component is mounted, in the keyboard shortcuts sheet ("?"),
// which reads them from hotkeyRegistry.

export interface Hotkey {
  /** KeyboardEvent.key, compared case-insensitively for letters, e.g. "a", "[", "ArrowDown", "1". */
  key: string;
  handler: (event: KeyboardEvent) => void;
  /** Shown in the shortcuts sheet; hotkeys without one still work but are not listed. */
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

/** Open dialogs, modal or not. Dialogs in this app are unmounted when they close, so presence means open. */
export const OPEN_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/** True while a dialog is open: neither page nor shell shortcuts act behind one. */
export function isDialogOpen(root: Pick<ParentNode, "querySelector"> = document): boolean {
  return root.querySelector(OPEN_DIALOG_SELECTOR) !== null;
}

/** True while an input method editor is composing (Chinese, Japanese and Korean input). */
export function isComposing(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** True when a key event matches a hotkey definition (exported for tests). */
export function matchesHotkey(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">, hotkey: Pick<Hotkey, "key" | "alt">): boolean {
  if (event.ctrlKey || event.metaKey) return false;
  if (Boolean(hotkey.alt) !== event.altKey) return false;
  return event.key.length === 1 && hotkey.key.length === 1 ? event.key.toLowerCase() === hotkey.key.toLowerCase() : event.key === hotkey.key;
}

// ---------------------------------------------------------------------------
// Registry of the described hotkeys that are currently active
// ---------------------------------------------------------------------------

/** A hotkey as the shortcuts sheet lists it. */
export interface HotkeyInfo {
  key: string;
  alt: boolean;
  description: string;
}

export interface HotkeyRegistry {
  /** Adds a component's hotkeys; the returned function removes them again. */
  register(entries: readonly HotkeyInfo[]): () => void;
  subscribe(listener: () => void): () => void;
  /** Active hotkeys in registration order, one per key (the first registration wins, as it does at key time). */
  getSnapshot(): readonly HotkeyInfo[];
}

const NO_HOTKEYS: readonly HotkeyInfo[] = [];

function keyId(entry: Pick<HotkeyInfo, "key" | "alt">): string {
  return `${entry.alt ? "alt+" : ""}${entry.key.length === 1 ? entry.key.toLowerCase() : entry.key}`;
}

export function createHotkeyRegistry(): HotkeyRegistry {
  const groups = new Map<number, readonly HotkeyInfo[]>();
  const listeners = new Set<() => void>();
  let nextId = 1;
  let snapshot: readonly HotkeyInfo[] = NO_HOTKEYS;

  const rebuild = () => {
    const seen = new Set<string>();
    const list: HotkeyInfo[] = [];
    for (const entries of groups.values()) {
      for (const entry of entries) {
        const id = keyId(entry);
        if (seen.has(id)) continue;
        seen.add(id);
        list.push(entry);
      }
    }
    snapshot = list.length > 0 ? list : NO_HOTKEYS;
    for (const listener of listeners) listener();
  };

  return {
    register(entries) {
      if (entries.length === 0) return () => {};
      const id = nextId++;
      groups.set(id, entries);
      rebuild();
      return () => {
        if (groups.delete(id)) rebuild();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
}

/** The page hotkeys of the current view, read by the keyboard shortcuts sheet. */
export const hotkeyRegistry = createHotkeyRegistry();

/** The described hotkeys that are active right now. */
export function useActiveHotkeys(): readonly HotkeyInfo[] {
  return useSyncExternalStore(hotkeyRegistry.subscribe, hotkeyRegistry.getSnapshot, () => NO_HOTKEYS);
}

/** A stable encoding of the described hotkeys, so a component re-registers only when keys or descriptions change. */
export function hotkeySignature(hotkeys: ReadonlyArray<Pick<Hotkey, "key" | "alt" | "description">>): string {
  return JSON.stringify(hotkeys.flatMap((h) => (h.description ? [[h.key, Boolean(h.alt), h.description]] : [])));
}

function fromSignature(signature: string): HotkeyInfo[] {
  return (JSON.parse(signature) as Array<[string, boolean, string]>).map(([key, alt, description]) => ({ key, alt, description }));
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  " ": "Space",
};

/** Key caps for a hotkey, e.g. ["Alt", "↑"] or ["A"]. */
export function hotkeyKeys(hotkey: Pick<HotkeyInfo, "key" | "alt">): string[] {
  const main = KEY_NAMES[hotkey.key] ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
  return hotkey.alt ? ["Alt", main] : [main];
}

/** Registers single-key shortcuts while the calling component is mounted (and `enabled`). */
export function useHotkeys(hotkeys: readonly Hotkey[], enabled = true): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isComposing(event) || isTypingTarget(event.target) || isDialogOpen()) return;
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

  const signature = hotkeySignature(hotkeys);
  useEffect(() => {
    if (!enabled) return;
    return hotkeyRegistry.register(fromSignature(signature));
  }, [enabled, signature]);
}
