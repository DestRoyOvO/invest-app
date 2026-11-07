"use client";

import { useSyncExternalStore } from "react";

import type { LocalStore } from "@/lib/local-store";

/** Current value of a localStorage-backed store (lib/local-store.ts); the store's empty value during SSR. */
export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
