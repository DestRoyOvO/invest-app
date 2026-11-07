// Client-side fetch helpers. Non-2xx responses throw ApiError so SWR keeps the last good data
// and the UI can show a proper error state instead of rendering an error body as data.

import type { ApiErrorBody, ApiErrorCode } from "@/types/api";

export type ClientErrorCode = ApiErrorCode | "network";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ClientErrorCode,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  return !!error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string";
}

export async function toApiError(res: Response): Promise<ApiError> {
  let code: ClientErrorCode = res.status === 404 ? "not_found" : res.status === 429 ? "rate_limited" : "internal_error";
  let message = res.statusText || "Request failed";
  try {
    const body: unknown = await res.json();
    if (isErrorBody(body)) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // Non-JSON error body (e.g. a proxy error page): keep the defaults.
  }
  const retryAfter = Number(res.headers.get("retry-after"));
  return new ApiError(res.status, code, message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
}

export async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "network", "Network error");
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/plain" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network", "Network error");
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

/** Path for a symbol, safely encoded (e.g. ^GSPC -> /stock/%5EGSPC). */
export function stockPath(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol)}`;
}

export function symbolsParam(symbols: string[]): string {
  return symbols.map(encodeURIComponent).join(",");
}
