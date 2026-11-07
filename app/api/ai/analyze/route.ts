import { noteSpecId } from "@/lib/ai-notes";
import { buildAnalyzeContext, type ContextResult } from "@/lib/server/ai-context";
import { parseAnalyzeRequest } from "@/lib/server/ai-schemas";
import { jsonError, upstreamError } from "@/lib/server/http";
import { noteCacheKey, readCachedNote, storeNote, teeOnComplete, textStream } from "@/lib/server/note-cache";
import { buildAnalyzeMessages } from "@/lib/server/prompts";
import { RATE_LIMITS } from "@/lib/server/rate-limit";
import { guardAiRequest, openAiStream, readJsonRequest } from "@/lib/server/request-guard";
import { AI_HEADERS, type AnalyzeKind, type MarketState } from "@/types/api";

// POST /api/ai/analyze  AnalyzeRequest -> text/plain stream of a Markdown research note (headers: AI_HEADERS).
// The client only names what to analyze; the prompt context is built on the server from server-side data. A note
// for byte-identical context written in the last 15 minutes is served from the note cache unless `force` is set.

const MAX_BODY_BYTES = 16 * 1024;
const TEMPERATURE = 0.3;
const MAX_TOKENS: Record<AnalyzeKind, number> = { stock: 1400, watchlist: 1400, market: 1100, sector: 1100, news: 1100, move: 1000 };

/**
 * Generations stop at a 120 s deadline (240 s for a reasoning model, lib/server/deepseek.ts); allow a little longer so
 * the error marker can be sent.
 */
export const maxDuration = 250;

interface NoteMeta {
  dataAsOf: string | null;
  marketState: MarketState | null;
  cache: "hit" | "miss";
  generatedAt: string;
}

function noteResponse(body: ReadableStream<Uint8Array>, meta: NoteMeta, base?: Headers): Response {
  const headers = new Headers(base);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");
  if (meta.dataAsOf) headers.set(AI_HEADERS.dataAsOf, meta.dataAsOf);
  if (meta.marketState) headers.set(AI_HEADERS.marketState, meta.marketState);
  headers.set(AI_HEADERS.noteCache, meta.cache);
  headers.set(AI_HEADERS.generatedAt, meta.generatedAt);
  return new Response(body, { status: 200, headers });
}

export async function POST(request: Request): Promise<Response> {
  const denied = guardAiRequest(request, RATE_LIMITS.analyze);
  if (denied) return denied;

  const body = await readJsonRequest(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseAnalyzeRequest(body.body);
  if (!parsed.ok) return jsonError(400, "bad_request", parsed.message);
  const analysis = parsed.data;

  let context: ContextResult;
  try {
    context = await buildAnalyzeContext(analysis);
  } catch (error) {
    return upstreamError("ai/analyze", error);
  }
  if (!context.ok) return jsonError(context.status, context.code, context.message);

  const key = noteCacheKey({ kind: analysis.kind, spec: noteSpecId(analysis.kind, context.asset), lang: analysis.lang, context: context.text });
  const meta = { dataAsOf: context.dataAsOf ?? null, marketState: context.marketState ?? null };
  if (!analysis.force) {
    const hit = readCachedNote(key);
    if (hit) return noteResponse(textStream(hit.text), { ...meta, cache: "hit", generatedAt: hit.createdAt });
  }

  const messages = buildAnalyzeMessages({
    kind: analysis.kind,
    lang: analysis.lang,
    context: context.text,
    subject: context.subject[analysis.lang],
    asset: context.asset,
  });
  const response = openAiStream(request, { messages, maxTokens: MAX_TOKENS[analysis.kind], temperature: TEMPERATURE });
  if (response.status !== 200 || !response.body) return response;
  const generatedAt = new Date().toISOString();
  // A client that left mid-stream ends the stream quietly, so a note is only stored when the request is still open.
  const stream = teeOnComplete(response.body, (text) => {
    if (!request.signal.aborted) storeNote(key, { text, createdAt: generatedAt });
  });
  return noteResponse(stream, { ...meta, cache: "miss", generatedAt }, response.headers);
}
