// What the AI features keep in this browser (lib/local-store.ts): the "Include my positions" setting, the last
// research note per request and up to 20 chat conversations. Nothing here leaves the browser except as part of an AI
// request the investor makes.

import { MAX_COMPARE_SYMBOLS, type ChatIntentInput, type Lang } from "@/types/api";

import { createLocalStore } from "./local-store";
import { normalizeSymbol } from "./symbols";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const AI_PREFS_KEY = "investseek:ai:v1";

export interface AiPrefs {
  /** Send the investor's positions with AI requests (the chat footer says they go to DeepSeek). On by default. */
  includePositions: boolean;
}

const DEFAULT_PREFS: AiPrefs = { includePositions: true };

export function sanitizeAiPrefs(raw: unknown): AiPrefs {
  if (!isRecord(raw)) return DEFAULT_PREFS;
  return { includePositions: typeof raw.includePositions === "boolean" ? raw.includePositions : DEFAULT_PREFS.includePositions };
}

export const aiPrefsStore = createLocalStore<AiPrefs>({ key: AI_PREFS_KEY, sanitize: sanitizeAiPrefs, empty: DEFAULT_PREFS });

export function setIncludePositions(includePositions: boolean): void {
  aiPrefsStore.update((prefs) => ({ ...prefs, includePositions }));
}

// ---------------------------------------------------------------------------
// Research notes
// ---------------------------------------------------------------------------

export const AI_NOTES_KEY = "investseek:ai-notes:v1";
export const MAX_SAVED_NOTES = 20;
const MAX_NOTE_CHARS = 12_000;
/** Note keys are short ("watchlist::en:<hash>", see noteKey in hooks/useAiStream.ts); longer ones are dropped. */
export const MAX_NOTE_KEY_CHARS = 120;

/**
 * A 53-bit hash of a string in base 36 (cyrb53, at most 11 characters): a short, stable key for a long request. With
 * 20 saved notes a collision is vanishingly unlikely.
 */
export function requestHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface SavedNote {
  text: string;
  /** The model stopped at the token limit. */
  truncated: boolean;
  /** ISO time the note was written. */
  generatedAt: string;
  /** ISO time of the newest regular-session trade in the note's data, when known. */
  dataAsOf: string | null;
  /** Market state of that data, e.g. "REGULAR" or "CLOSED". */
  marketState: string | null;
  /** The server reused an identical earlier note instead of writing a new one. */
  reused: boolean;
}

export type SavedNotes = Readonly<Record<string, SavedNote>>;

const EMPTY_NOTES: SavedNotes = {};

function sanitizeNote(raw: unknown): SavedNote | null {
  if (!isRecord(raw) || typeof raw.text !== "string" || !raw.text.trim() || !isIsoTime(raw.generatedAt)) return null;
  return {
    text: raw.text.slice(0, MAX_NOTE_CHARS),
    truncated: raw.truncated === true,
    generatedAt: raw.generatedAt,
    dataAsOf: isIsoTime(raw.dataAsOf) ? raw.dataAsOf : null,
    marketState: typeof raw.marketState === "string" ? raw.marketState.slice(0, 16) : null,
    reused: raw.reused === true,
  };
}

/** Keeps the MAX_SAVED_NOTES most recently written notes. */
function capNotes(entries: Array<[string, SavedNote]>): SavedNotes {
  const kept = entries.sort((a, b) => b[1].generatedAt.localeCompare(a[1].generatedAt)).slice(0, MAX_SAVED_NOTES);
  return Object.fromEntries(kept);
}

export function sanitizeSavedNotes(raw: unknown): SavedNotes {
  if (!isRecord(raw)) return EMPTY_NOTES;
  const entries: Array<[string, SavedNote]> = [];
  for (const [key, value] of Object.entries(raw)) {
    const note = key.length <= MAX_NOTE_KEY_CHARS ? sanitizeNote(value) : null;
    if (note) entries.push([key, note]);
  }
  return entries.length > 0 ? capNotes(entries) : EMPTY_NOTES;
}

/** The notes with `note` stored under `key` (replacing an older note for the same request), capped. */
export function rememberNote(notes: SavedNotes, key: string, note: SavedNote): SavedNotes {
  const clean = key.length <= MAX_NOTE_KEY_CHARS ? sanitizeNote(note) : null;
  if (!clean) return notes;
  return capNotes([...Object.entries(notes).filter(([existing]) => existing !== key), [key, clean]]);
}

export const aiNotesStore = createLocalStore<SavedNotes>({ key: AI_NOTES_KEY, sanitize: sanitizeSavedNotes, empty: EMPTY_NOTES });

export function saveNote(key: string, note: SavedNote): void {
  aiNotesStore.update((notes) => rememberNote(notes, key, note));
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const AI_CHATS_KEY = "investseek:ai-chats:v1";
export const MAX_CONVERSATIONS = 20;
export const MAX_CHAT_MESSAGES = 20;
const MAX_CHAT_MESSAGE_CHARS = 8_000;
const MAX_TITLE_CHARS = 80;

/** The page a message was asked from, so the chat can mark where the context changed. */
export interface ChatContextRef {
  /** Stable id such as "stock:NVDA", "sector:technology", "watchlist" or "market". */
  key: string;
  /** What the reader saw, e.g. "NVDA" or "Information Technology". */
  label: string;
}

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ISO time. */
  at: string;
  context: ChatContextRef | null;
  /** The subject of a seeded question (user messages only). */
  intent?: ChatIntentInput;
  /** The answer stopped at the token limit. */
  truncated?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lang: Lang;
  messages: StoredChatMessage[];
}

export interface ChatHistory {
  /** Most recently updated first. */
  conversations: Conversation[];
  /** The conversation open in the drawer, if any. */
  activeId: string | null;
}

const EMPTY_HISTORY: ChatHistory = { conversations: [], activeId: null };

function sanitizeContextRef(raw: unknown): ChatContextRef | null {
  if (!isRecord(raw) || typeof raw.key !== "string" || typeof raw.label !== "string") return null;
  return { key: raw.key.slice(0, 80), label: raw.label.slice(0, 80) };
}

export function sanitizeIntent(raw: unknown): ChatIntentInput | undefined {
  if (!isRecord(raw)) return undefined;
  if ((raw.kind === "move" || raw.kind === "earnings") && typeof raw.symbol === "string") {
    const symbol = normalizeSymbol(raw.symbol);
    return symbol ? { kind: raw.kind, symbol } : undefined;
  }
  if (raw.kind === "compare" && Array.isArray(raw.symbols)) {
    const symbols = [...new Set(raw.symbols.map(normalizeSymbol).filter((s): s is string => s !== null))].slice(0, MAX_COMPARE_SYMBOLS);
    return symbols.length >= 2 ? { kind: "compare", symbols } : undefined;
  }
  return undefined;
}

function sanitizeMessage(raw: unknown): StoredChatMessage | null {
  if (!isRecord(raw) || (raw.role !== "user" && raw.role !== "assistant") || typeof raw.content !== "string" || !raw.content.trim()) return null;
  const message: StoredChatMessage = {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : `m-${Math.random().toString(36).slice(2, 10)}`,
    role: raw.role,
    content: raw.content.slice(0, MAX_CHAT_MESSAGE_CHARS),
    at: isIsoTime(raw.at) ? raw.at : new Date(0).toISOString(),
    context: sanitizeContextRef(raw.context),
  };
  const intent = raw.role === "user" ? sanitizeIntent(raw.intent) : undefined;
  if (intent) message.intent = intent;
  if (raw.role === "assistant" && raw.truncated === true) message.truncated = true;
  return message;
}

function sanitizeConversation(raw: unknown): Conversation | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.map(sanitizeMessage).filter((m): m is StoredChatMessage => m !== null).slice(-MAX_CHAT_MESSAGES);
  if (messages.length === 0) return null;
  const updatedAt = isIsoTime(raw.updatedAt) ? raw.updatedAt : messages[messages.length - 1].at;
  return {
    id: raw.id.slice(0, 40),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, MAX_TITLE_CHARS) : conversationTitle(messages),
    createdAt: isIsoTime(raw.createdAt) ? raw.createdAt : messages[0].at,
    updatedAt,
    lang: raw.lang === "zh" ? "zh" : "en",
    messages,
  };
}

export function sanitizeChatHistory(raw: unknown): ChatHistory {
  if (!isRecord(raw) || !Array.isArray(raw.conversations)) return EMPTY_HISTORY;
  const seen = new Set<string>();
  const conversations = raw.conversations
    .map(sanitizeConversation)
    .filter((c): c is Conversation => c !== null && !seen.has(c.id) && Boolean(seen.add(c.id)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_CONVERSATIONS);
  if (conversations.length === 0) return EMPTY_HISTORY;
  const activeId = typeof raw.activeId === "string" && conversations.some((c) => c.id === raw.activeId) ? raw.activeId : null;
  return { conversations, activeId };
}

/** The first question, shortened: how a conversation is listed in the history. */
export function conversationTitle(messages: readonly StoredChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").trim() ?? "";
  return first.length > MAX_TITLE_CHARS ? `${first.slice(0, MAX_TITLE_CHARS - 1)}…` : first;
}

/** The history with `conversation` saved (replacing its older copy), made active and listed first; capped. */
export function upsertConversation(history: ChatHistory, conversation: Conversation): ChatHistory {
  const clean = sanitizeConversation(conversation);
  if (!clean) return history;
  const others = history.conversations.filter((c) => c.id !== clean.id);
  return { conversations: [clean, ...others].slice(0, MAX_CONVERSATIONS), activeId: clean.id };
}

export const aiChatsStore = createLocalStore<ChatHistory>({ key: AI_CHATS_KEY, sanitize: sanitizeChatHistory, empty: EMPTY_HISTORY });

export function saveConversation(conversation: Conversation): void {
  aiChatsStore.update((history) => upsertConversation(history, conversation));
}

export function setActiveConversation(id: string | null): void {
  aiChatsStore.update((history) => ({ ...history, activeId: id && history.conversations.some((c) => c.id === id) ? id : null }));
}

/** Removes every saved conversation and returns what was there, for Undo. */
export function clearChatHistory(): ChatHistory {
  const before = aiChatsStore.getSnapshot();
  aiChatsStore.write(EMPTY_HISTORY);
  return before;
}

export function restoreChatHistory(history: ChatHistory): void {
  aiChatsStore.write(sanitizeChatHistory(history));
}

export function newConversationId(now: number = Date.now()): string {
  return `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
