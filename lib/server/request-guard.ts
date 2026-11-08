import "server-only";

import type { NextResponse } from "next/server";

import type { ApiErrorBody } from "@/types/api";

import { checkAiAccess } from "./auth";
import { aiTextResponse, AiNotConfiguredError, streamChat, type LlmMessage } from "./deepseek";
import { BodyError, clientIp, jsonError, readJsonBody } from "./http";
import { log } from "./log";
import { checkDailyBudget, clientKey, consumeDailyBudget, consumeRateLimit, marketRateLimit, refundDailyBudget, type RateLimitRule } from "./rate-limit";

// Guards shared by the state-changing POST routes (AI, login, logout), and the final step of the AI pipeline.

const DAILY_LIMIT_MESSAGE = "The daily AI limit for this server has been reached.";

const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

function hostOf(value: string, protocol: string): string | null {
  try {
    return new URL(`${protocol}//${value.trim()}`).host;
  } catch {
    return null;
  }
}

/**
 * Same-origin check (CSRF defence for cookie-authenticated POSTs).
 * Browsers send Sec-Fetch-Site, which must be "same-origin" (or "none" for user-initiated navigation).
 * Without it, an Origin header must match the request host. Requests with neither header do not come from a
 * cross-site browser context (e.g. curl) and are left to the other controls.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return ALLOWED_FETCH_SITES.has(fetchSite.trim().toLowerCase());

  const origin = request.headers.get("origin");
  if (origin === null) return true;
  let originUrl: URL;
  try {
    originUrl = new URL(origin); // "null" (sandboxed iframes, file://) does not parse and is rejected
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;

  const candidates = [request.headers.get("host"), request.headers.get("x-forwarded-host")?.split(",")[0]];
  return candidates.some((value) => !!value && hostOf(value, originUrl.protocol) === originUrl.host);
}

/** 403 for cross-site requests, null when the request may proceed. */
export function rejectCrossSite(request: Request): NextResponse<ApiErrorBody> | null {
  return isSameOriginRequest(request) ? null : jsonError(403, "forbidden", "Cross-site requests are not allowed.");
}

export function rateLimitedResponse(retryAfterSeconds: number, message: string): NextResponse<ApiErrorBody> {
  return jsonError(429, "rate_limited", message, { "Retry-After": String(retryAfterSeconds) });
}

/** Per-client limit for the public market-data GET routes; null when the request may proceed. */
export function limitPublicRequest(request: Request): NextResponse<ApiErrorBody> | null {
  const limit = consumeRateLimit(marketRateLimit(), clientKey(clientIp(request)));
  return limit.ok ? null : rateLimitedResponse(limit.retryAfterSeconds, "Too many requests. Please slow down and retry shortly.");
}

/**
 * Charges extra units of the public budget, one per additional upstream call a request will make (the request itself
 * was charged by limitPublicRequest). Null when the request may proceed.
 */
export function chargePublicRequest(request: Request, units: number): NextResponse<ApiErrorBody> | null {
  const key = clientKey(clientIp(request));
  const rule = marketRateLimit();
  for (let i = 0; i < units; i++) {
    const limit = consumeRateLimit(rule, key);
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds, "Too many requests. Please slow down and retry shortly.");
  }
  return null;
}

/**
 * Runs the checks every AI request passes before any work is done:
 * same-origin -> access (401/403) -> per-IP rate limit (429) -> daily budget not yet exhausted (429).
 * The daily budget itself is consumed later, right before the model is called.
 */
export function guardAiRequest(request: Request, rule: RateLimitRule): NextResponse<ApiErrorBody> | null {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const denied = checkAiAccess(request);
  if (denied) return jsonError(denied.status, denied.code, denied.message);

  const limit = consumeRateLimit(rule, clientKey(clientIp(request)));
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSeconds, "Too many AI requests. Please wait a moment and retry.");

  const budget = checkDailyBudget();
  if (!budget.ok) return rateLimitedResponse(budget.retryAfterSeconds, DAILY_LIMIT_MESSAGE);

  return null;
}

export interface AiStreamParams {
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
}

/**
 * Last step of an AI request: uses one unit of the daily budget and starts streaming the model output.
 * The request signal is passed through, so a client disconnect cancels the generation upstream.
 */
export function openAiStream(request: Request, { messages, maxTokens, temperature }: AiStreamParams): Response {
  // The client left while the context was being built: do not spend a model call on nobody.
  if (request.signal.aborted) return new Response(null, { status: 499 });

  const budget = consumeDailyBudget();
  if (!budget.ok) return rateLimitedResponse(budget.retryAfterSeconds, DAILY_LIMIT_MESSAGE);

  try {
    return aiTextResponse(streamChat({ messages, maxTokens, temperature, signal: request.signal }));
  } catch (error) {
    refundDailyBudget();
    if (error instanceof AiNotConfiguredError) return jsonError(403, "ai_unavailable", "AI is not configured on this server.");
    log("error", "ai.start_failed", { type: error instanceof Error ? error.name : "unknown" });
    return jsonError(500, "internal_error", "Could not start the AI response.");
  }
}

export type JsonBodyResult = { ok: true; body: unknown } | { ok: false; response: NextResponse<ApiErrorBody> };

/**
 * The same request with a body stream that errors (413) once more than `maxBytes` have arrived. readJsonBody only
 * checks the size after reading the whole body when no Content-Length is declared, so without this a chunked upload
 * could make the server buffer an arbitrarily large body.
 */
function withBodyLimit(request: Request, maxBytes: number): Request {
  if (!request.body) return request;
  const source = request.body.getReader();
  let received = 0;
  const limited = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await source.read();
        if (done) return controller.close();
        received += value.byteLength;
        if (received <= maxBytes) return controller.enqueue(value);
        const tooLarge = new BodyError(413, "payload_too_large", "Request body is too large.");
        controller.error(tooLarge);
        await source.cancel(tooLarge); // stop reading the upload
      },
      cancel: (reason) => source.cancel(reason),
    },
    { highWaterMark: 0 }, // read only when readJsonBody asks, so a rejected content type reads nothing
  );
  const init: RequestInit & { duplex: "half" } = { method: request.method, headers: request.headers, body: limited, duplex: "half" };
  return new Request(request.url, init);
}

/** readJsonBody (JSON content type and size limit) with its errors turned into responses. */
export async function readJsonRequest(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  try {
    return { ok: true, body: await readJsonBody(withBodyLimit(request, maxBytes), maxBytes) };
  } catch (error) {
    const bodyError = error instanceof BodyError ? error : error instanceof Error && error.cause instanceof BodyError ? error.cause : null;
    if (bodyError) return { ok: false, response: jsonError(bodyError.status, bodyError.code, bodyError.message) };
    return { ok: false, response: jsonError(400, "bad_request", "Could not read the request body.") };
  }
}
