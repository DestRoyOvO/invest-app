import "server-only";

import { NextResponse } from "next/server";

import type { ApiErrorBody, ApiErrorCode } from "@/types/api";

/** JSON success response. `cacheSeconds` sets a shared CDN cache (s-maxage + stale-while-revalidate). */
export function jsonOk<T>(data: T, options: { cacheSeconds?: number; status?: number } = {}): NextResponse<T> {
  const headers = new Headers();
  if (options.cacheSeconds && options.cacheSeconds > 0) {
    headers.set(
      "Cache-Control",
      `public, max-age=0, s-maxage=${options.cacheSeconds}, stale-while-revalidate=${options.cacheSeconds * 4}`,
    );
  } else {
    headers.set("Cache-Control", "no-store");
  }
  return NextResponse.json(data, { status: options.status ?? 200, headers });
}

/** JSON error response in the shared ApiErrorBody shape. Never include internal error details in `message`. */
export function jsonError(status: number, code: ApiErrorCode, message: string, headers?: HeadersInit): NextResponse<ApiErrorBody> {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  return NextResponse.json({ error: { code, message } }, { status, headers: h });
}

/** Logs the real error on the server and returns a generic 502 to the client. */
export function upstreamError(context: string, error: unknown): NextResponse<ApiErrorBody> {
  console.error(`[${context}]`, error);
  return jsonError(502, "upstream_error", "Market data provider is unavailable. Please retry shortly.");
}

export class BodyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads a JSON request body with a size limit and a JSON content type.
 * Throws BodyError (413/415/400) that callers turn into jsonError().
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new BodyError(415, "bad_request", "Content-Type must be application/json.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyError(413, "payload_too_large", "Request body is too large.");
  }
  const text = await readCappedText(request, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError(400, "bad_request", "Request body is not valid JSON.");
  }
}

/** Reads the body as UTF-8, stopping (413) as soon as more than `maxBytes` arrive, even without Content-Length. */
async function readCappedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyError(413, "payload_too_large", "Request body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400, "bad_request", "Request body could not be read.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function firstHop(header: string | null): string | null {
  const hop = header?.split(",")[0]?.trim();
  return hop ? hop : null;
}

function lastHop(header: string | null): string | null {
  const hops = header?.split(",").map((h) => h.trim()).filter(Boolean) ?? [];
  return hops.length ? hops[hops.length - 1] : null;
}

/**
 * Client address for rate limiting. Forwarded headers are client-controlled unless a trusted proxy sets them:
 * - on Vercel, X-Real-IP / X-Forwarded-For are set by the platform;
 * - with TRUST_PROXY=1 (your own reverse proxy appends to X-Forwarded-For), the right-most hop is used;
 * - otherwise the headers are ignored and all clients share one bucket ("direct"), so spoofing cannot evade limits.
 */
export function clientIp(request: Request): string {
  const headers = request.headers;
  if (process.env.VERCEL) {
    return headers.get("x-real-ip")?.trim() || firstHop(headers.get("x-forwarded-for")) || "unknown";
  }
  const trustProxy = (process.env.TRUST_PROXY ?? "").toLowerCase();
  if (trustProxy === "1" || trustProxy === "true") {
    return lastHop(headers.get("x-forwarded-for")) || headers.get("x-real-ip")?.trim() || "unknown";
  }
  return "direct";
}
