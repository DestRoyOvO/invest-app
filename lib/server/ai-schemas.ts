import { z } from "zod";

import { normalizeSymbol } from "@/lib/symbols";
import { MAX_WATCHLIST, SECTOR_KEYS } from "@/lib/universe";
import type { AnalyzeRequest, ChatMessage, ChatRequest } from "@/types/api";

// Request validation for the AI and auth routes. Client-written text only ever reaches the model as chat
// messages; everything else is an identifier that the server resolves to its own data.
// The module has no server-only marker on purpose: it holds no secrets, so the client may reuse CHAT_LIMITS.

export const CHAT_LIMITS = {
  /** Most recent messages kept after normalization. */
  maxMessages: 10,
  maxMessageChars: 2_000,
  maxTotalChars: 12_000,
  /** Bounds on the raw input, before normalization. */
  maxIncomingMessages: 100,
  maxIncomingMessageChars: 20_000,
} as const;

const MAX_TITLE_CHARS = 300;

const langSchema = z.enum(["en", "zh"]);

const symbolSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const symbol = normalizeSymbol(value);
    if (symbol === null) {
      ctx.addIssue({ code: "custom", message: "Invalid symbol." });
      return z.NEVER;
    }
    return symbol;
  });

const sectorSchema = z.enum(SECTOR_KEYS);

const symbolListSchema = z
  .array(symbolSchema)
  .max(MAX_WATCHLIST)
  .transform((symbols) => [...new Set(symbols)]);

const newsIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Invalid news id.");

/** Optional free text supplied by the client as a fallback; whitespace is collapsed and the length capped. */
const titleSchema = z
  .string()
  .max(2_000)
  .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS));

const positionSchema = z.object({
  symbol: symbolSchema,
  shares: z.number().finite().positive().max(1e9),
  cost: z.number().finite().positive().max(1e7),
});

export const analyzeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("market"), lang: langSchema }),
  z.object({ kind: z.literal("stock"), symbol: symbolSchema, lang: langSchema }),
  z.object({ kind: z.literal("sector"), sector: sectorSchema, lang: langSchema }),
  z.object({
    kind: z.literal("watchlist"),
    symbols: symbolListSchema.pipe(z.array(z.string()).min(1)),
    lang: langSchema,
    positions: z.array(positionSchema).max(MAX_WATCHLIST).optional(),
  }),
  z.object({
    kind: z.literal("news"),
    newsId: newsIdSchema,
    lang: langSchema,
    link: z.string().trim().max(2_048).optional(),
    title: titleSchema.optional(),
  }),
]);

export type NormalizeChatResult = { ok: true; messages: ChatMessage[] } | { ok: false; message: string };

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function totalChars(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

/**
 * Joins consecutive messages of the same role, e.g. a question whose answer failed followed by a new question:
 * the model API expects alternating turns.
 */
function mergeSameRole(messages: readonly ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous?.role === message.role) merged[merged.length - 1] = { role: message.role, content: `${previous.content}\n\n${message.content}` };
    else merged.push({ role: message.role, content: message.content });
  }
  return merged;
}

/**
 * Normalizes a chat history: trims every message and drops empty ones, requires the last message to be a user
 * message of 1..2000 characters, keeps the last 10 messages, caps older messages at 2000 characters, joins
 * consecutive messages of the same role, drops the oldest messages until the total is at most 12000 characters,
 * and starts the history with a user message.
 */
export function normalizeChatMessages(input: readonly ChatMessage[]): NormalizeChatResult {
  const trimmed = input
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0);

  const last = trimmed[trimmed.length - 1];
  if (!last || last.role !== "user") {
    return { ok: false, message: "The last message must be a non-empty user message." };
  }
  if (last.content.length > CHAT_LIMITS.maxMessageChars) {
    return { ok: false, message: `Messages are limited to ${CHAT_LIMITS.maxMessageChars} characters.` };
  }

  let kept = trimmed
    .slice(-CHAT_LIMITS.maxMessages)
    .map((message) => ({ role: message.role, content: truncate(message.content, CHAT_LIMITS.maxMessageChars) }));
  // Terminates: the last message alone is within the total.
  while (totalChars(mergeSameRole(kept)) > CHAT_LIMITS.maxTotalChars) kept = kept.slice(1);
  let messages = mergeSameRole(kept);
  while (messages[0].role !== "user") messages = messages.slice(1); // terminates: the last message is a user message
  return { ok: true, messages };
}

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(CHAT_LIMITS.maxIncomingMessageChars),
});

const chatContextSchema = z
  .object({
    view: z.enum(["market", "stock", "sector", "watchlist"]),
    symbol: symbolSchema.optional(),
    sector: sectorSchema.optional(),
    symbols: symbolListSchema.optional(),
  })
  .superRefine((context, ctx) => {
    if (context.view === "stock" && !context.symbol) {
      ctx.addIssue({ code: "custom", path: ["symbol"], message: "A symbol is required for the stock view." });
    }
    if (context.view === "sector" && !context.sector) {
      ctx.addIssue({ code: "custom", path: ["sector"], message: "A sector is required for the sector view." });
    }
  });

export const chatRequestSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1)
    .max(CHAT_LIMITS.maxIncomingMessages)
    .transform((messages, ctx) => {
      const result = normalizeChatMessages(messages);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.message });
        return z.NEVER;
      }
      return result.messages;
    }),
  lang: langSchema,
  context: chatContextSchema,
});

export const loginRequestSchema = z.object({
  password: z.string().min(1).max(256),
});

export type ParseResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** A short, safe description of the first validation issue (schema paths and messages only, never input values). */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body.";
  const path = issue.path.map(String).join(".");
  return (path ? `${path}: ${issue.message}` : issue.message).slice(0, 200);
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  return result.success ? { ok: true, data: result.data } : { ok: false, message: describeIssue(result.error) };
}

export function parseAnalyzeRequest(input: unknown): ParseResult<AnalyzeRequest> {
  return parseWith(analyzeRequestSchema, input);
}

export function parseChatRequest(input: unknown): ParseResult<ChatRequest> {
  return parseWith(chatRequestSchema, input);
}

export function parseLoginRequest(input: unknown): ParseResult<{ password: string }> {
  return parseWith(loginRequestSchema, input);
}
