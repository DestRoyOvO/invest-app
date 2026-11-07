import { buildAnalyzeContext, type ContextResult } from "@/lib/server/ai-context";
import { parseAnalyzeRequest } from "@/lib/server/ai-schemas";
import { jsonError, upstreamError } from "@/lib/server/http";
import { buildAnalyzeMessages } from "@/lib/server/prompts";
import { RATE_LIMITS } from "@/lib/server/rate-limit";
import { guardAiRequest, openAiStream, readJsonRequest } from "@/lib/server/request-guard";

// POST /api/ai/analyze  AnalyzeRequest -> text/plain stream of a Markdown research note.
// The client only names what to analyze; the prompt context is built on the server from server-side data.

const MAX_BODY_BYTES = 16 * 1024;
const TEMPERATURE = 0.3;

/** Generations stop at a 120 s deadline (lib/server/deepseek.ts); allow a little longer so the error marker can be sent. */
export const maxDuration = 130;

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

  const messages = buildAnalyzeMessages({
    kind: analysis.kind,
    lang: analysis.lang,
    context: context.text,
    subject: context.subject[analysis.lang],
  });
  return openAiStream(request, { messages, maxTokens: analysis.kind === "stock" || analysis.kind === "watchlist" ? 1400 : 1100, temperature: TEMPERATURE });
}
