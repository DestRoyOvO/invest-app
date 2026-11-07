import "server-only";

import OpenAI, { APIError } from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { CompletionUsage } from "openai/resources/completions";

import { AI_STREAM_ERROR, AI_STREAM_TRUNCATED, type ApiErrorCode } from "@/types/api";

// DeepSeek is OpenAI-compatible, so the official SDK is used with a different base URL.
// The client is created lazily and only from DEEPSEEK_API_KEY: without the key the AI features report
// "not configured" instead of letting the SDK fall back to OPENAI_API_KEY and send it to DeepSeek.

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** Time allowed until DeepSeek starts responding. The SDK retries once on connection errors, 408/409/429 and 5xx. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Hard cap on one whole generation, including the streamed body (the SDK timeout stops at the headers). */
const GENERATION_DEADLINE_MS = 120_000;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
  /** Pass request.signal so that a client disconnect cancels the upstream generation. */
  signal?: AbortSignal;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("DEEPSEEK_API_KEY is not set");
    this.name = "AiNotConfiguredError";
  }
}

function readApiKey(): string | null {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  return key ? key : null;
}

/** True when DEEPSEEK_API_KEY is set. Never constructs the client. */
export function isAiConfigured(): boolean {
  return readApiKey() !== null;
}

/** DEEPSEEK_MODEL when it looks like a model id, otherwise deepseek-chat. */
export function getModel(): string {
  const model = process.env.DEEPSEEK_MODEL?.trim();
  return model && MODEL_PATTERN.test(model) ? model : DEFAULT_MODEL;
}

let cachedClient: { key: string; client: OpenAI } | null = null;

function getClient(): OpenAI | null {
  const apiKey = readApiKey();
  if (!apiKey) return null;
  if (cachedClient?.key !== apiKey) {
    const client = new OpenAI({
      apiKey,
      baseURL: DEEPSEEK_BASE_URL,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
      // Explicit nulls stop the SDK from picking up OPENAI_* variables and forwarding them to DeepSeek.
      adminAPIKey: null,
      organization: null,
      project: null,
      webhookSecret: null,
      // Pinned so that OPENAI_LOG=debug cannot make the SDK log request bodies (the prompts).
      logLevel: "warn",
    });
    cachedClient = { key: apiKey, client };
  }
  return cachedClient.client;
}

/** Finish reasons that mean the provider cut the answer off rather than completing it. */
const INTERRUPTED_FINISH_REASONS: ReadonlySet<string> = new Set(["content_filter", "insufficient_system_resource"]);

/**
 * Error code for a completion that ended without a usable answer (no text at all, or cut off by the provider), or
 * null when it completed. DeepSeek reports finish reasons beyond the OpenAI set, e.g. "insufficient_system_resource".
 */
export function incompleteCompletionCode(emittedText: boolean, finishReason: string | null): ApiErrorCode | null {
  if (!emittedText) return "upstream_error";
  return finishReason !== null && INTERRUPTED_FINISH_REASONS.has(finishReason) ? "upstream_error" : null;
}

/** Maps an upstream failure to the error code appended after AI_STREAM_ERROR. */
export function streamErrorCode(error: unknown): ApiErrorCode {
  if (error instanceof APIError) {
    if (error.status === 429) return "rate_limited";
    // 401 invalid key, 402 insufficient balance, 403 forbidden: the owner has to fix the configuration.
    if (error.status === 401 || error.status === 402 || error.status === 403) return "ai_unavailable";
  }
  return "upstream_error";
}

function logUsage(model: string, usage: CompletionUsage, startedAt: number): void {
  // DeepSeek reports context-cache hits in a non-standard field.
  const cacheHit: unknown = (usage as unknown as Record<string, unknown>).prompt_cache_hit_tokens;
  console.info(
    `[ai] ${model} prompt=${usage.prompt_tokens} cached=${typeof cacheHit === "number" ? cacheHit : "n/a"} ` +
      `completion=${usage.completion_tokens} ms=${Date.now() - startedAt}`,
  );
}

function logFailure(model: string, error: unknown, timedOut: boolean): void {
  if (timedOut) {
    console.error(`[ai] ${model} generation exceeded ${GENERATION_DEADLINE_MS} ms`);
  } else if (error instanceof APIError) {
    console.error(`[ai] ${model} request failed`, { status: error.status ?? null, type: error.name, message: error.message.slice(0, 300) });
  } else {
    console.error(`[ai] ${model} stream failed`, error instanceof Error ? error.name : "unknown error");
  }
}

/**
 * Streams the text deltas of one chat completion as UTF-8 bytes.
 *
 * - Aborting `signal`, cancelling the returned stream or exceeding the generation deadline aborts the upstream request.
 * - If the request fails after the response has started (the HTTP status is already 200), or the completion ends
 *   without any text or is cut off by the provider, the stream ends with AI_STREAM_ERROR followed by an error code,
 *   e.g. "[[AI_STREAM_ERROR]]upstream_error".
 * - Message contents are never logged; only token usage and error metadata are.
 *
 * Throws AiNotConfiguredError synchronously when DEEPSEEK_API_KEY is missing.
 */
export function streamChat({ messages, maxTokens, temperature, signal }: StreamChatOptions): ReadableStream<Uint8Array> {
  const client = getClient();
  if (!client) throw new AiNotConfiguredError();

  const model = getModel();
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  const startedAt = Date.now();
  let iterator: AsyncIterator<ChatCompletionChunk> | null = null;
  let emittedText = false;
  let finishReason: string | null = null;
  let timedOut = false;
  let cancelled = false;
  let settled = false;

  const onCallerAbort = () => upstream.abort();
  const deadline = setTimeout(() => {
    timedOut = true;
    upstream.abort();
  }, GENERATION_DEADLINE_MS);
  if (signal?.aborted) upstream.abort();
  else signal?.addEventListener("abort", onCallerAbort, { once: true });

  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    signal?.removeEventListener("abort", onCallerAbort);
  };

  return new ReadableStream<Uint8Array>({
    // One text delta per pull, so a slow reader applies backpressure to the upstream stream.
    async pull(controller) {
      try {
        if (!iterator) {
          const completion = await client.chat.completions.create(
            {
              model,
              messages,
              max_tokens: maxTokens,
              temperature,
              stream: true,
              stream_options: { include_usage: true },
            },
            { signal: upstream.signal },
          );
          iterator = completion[Symbol.asyncIterator]();
        }
        for (;;) {
          const { done, value } = await iterator.next();
          if (done) {
            settle();
            // The SDK ends the iteration quietly instead of throwing when the request is aborted mid-stream, so a
            // deadline abort has to be reported here. A caller abort or cancel leaves nobody to tell.
            let failure: ApiErrorCode | null = null;
            if (timedOut) {
              logFailure(model, null, true);
              failure = "upstream_error";
            } else if (!upstream.signal.aborted) {
              failure = incompleteCompletionCode(emittedText, finishReason);
              if (failure) console.error(`[ai] ${model} completion ended without a full answer`, { finishReason, emittedText });
            }
            if (failure) controller.enqueue(encoder.encode(`${AI_STREAM_ERROR}${failure}`));
            else if (finishReason === "length" && !upstream.signal.aborted) controller.enqueue(encoder.encode(AI_STREAM_TRUNCATED));
            controller.close();
            return;
          }
          if (value.usage) logUsage(model, value.usage, startedAt);
          const choice = value.choices[0];
          const reason: string | null | undefined = choice?.finish_reason;
          if (reason) finishReason = reason;
          const text = choice?.delta?.content;
          if (text) {
            emittedText = true;
            controller.enqueue(encoder.encode(text));
            return;
          }
        }
      } catch (error) {
        settle();
        if (cancelled) return; // the reader went away; there is nobody to tell
        if (!signal?.aborted) logFailure(model, error, timedOut);
        try {
          controller.enqueue(encoder.encode(`${AI_STREAM_ERROR}${timedOut ? "upstream_error" : streamErrorCode(error)}`));
          controller.close();
        } catch {
          // The stream was closed concurrently.
        }
      }
    },
    cancel() {
      cancelled = true;
      settle();
      upstream.abort();
    },
  });
}

/** Wraps an AI text stream in the response format shared by the AI routes. */
export function aiTextResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Disables proxy buffering (nginx) so tokens reach the browser as they are generated.
      "X-Accel-Buffering": "no",
    },
  });
}
