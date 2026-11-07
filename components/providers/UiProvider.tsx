"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { NewsItem } from "@/types/api";

/** What a seeded question is about, so the assistant can load the right data (e.g. a move explainer). */
export type ChatIntent = { kind: "move"; symbol: string } | { kind: "compare"; symbols: string[] } | { kind: "earnings"; symbol: string };

export interface ChatSeed {
  text: string;
  intent?: ChatIntent;
}

/** Global UI state for overlays that can be opened from anywhere (command bar, chat, news reader). */
interface UiContextValue {
  commandOpen: boolean;
  openCommand: () => void;
  closeCommand: () => void;

  chatOpen: boolean;
  /** A question to send when the chat opens (the command bar's "?" prefix, "Why is it moving?" buttons). */
  chatSeed: ChatSeed | null;
  openChat: (seed?: string | ChatSeed) => void;
  closeChat: () => void;
  clearChatSeed: () => void;

  newsItem: NewsItem | null;
  openNews: (item: NewsItem) => void;
  closeNews: () => void;

  /** Symbol whose position editor is open, or null. The editor is mounted once in the shell. */
  positionEditor: string | null;
  openPositionEditor: (symbol: string) => void;
  closePositionEditor: () => void;

  /** Alert editor: a symbol to prefill, "" for a blank rule, or null when closed. Mounted once in the shell. */
  alertEditor: string | null;
  openAlertEditor: (symbol?: string) => void;
  closeAlertEditor: () => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState<ChatSeed | null>(null);
  const [newsItem, setNewsItem] = useState<NewsItem | null>(null);
  const [positionEditor, setPositionEditor] = useState<string | null>(null);
  const [alertEditor, setAlertEditor] = useState<string | null>(null);

  const openChat = useCallback((seed?: string | ChatSeed) => {
    if (seed) setChatSeed(typeof seed === "string" ? { text: seed } : seed);
    setChatOpen(true);
  }, []);

  const value = useMemo<UiContextValue>(
    () => ({
      commandOpen,
      openCommand: () => setCommandOpen(true),
      closeCommand: () => setCommandOpen(false),
      chatOpen,
      chatSeed,
      openChat,
      closeChat: () => setChatOpen(false),
      clearChatSeed: () => setChatSeed(null),
      newsItem,
      openNews: (item) => setNewsItem(item),
      closeNews: () => setNewsItem(null),
      positionEditor,
      openPositionEditor: (symbol) => setPositionEditor(symbol),
      closePositionEditor: () => setPositionEditor(null),
      alertEditor,
      openAlertEditor: (symbol) => setAlertEditor(symbol ?? ""),
      closeAlertEditor: () => setAlertEditor(null),
    }),
    [commandOpen, chatOpen, chatSeed, openChat, newsItem, positionEditor, alertEditor],
  );

  return <UiContext value={value}>{children}</UiContext>;
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used inside UiProvider");
  return ctx;
}
