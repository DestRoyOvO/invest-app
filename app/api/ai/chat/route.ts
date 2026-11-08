import { buildChatContext, type ContextResult } from "@/lib/server/ai-context";
import { parseChatRequest } from "@/lib/server/ai-schemas";
import { jsonError, upstreamError } from "@/lib/server/http";
import { buildChatMessages } from "@/lib/server/prompts";
import { RATE_LIMITS } from "@/lib/server/rate-limit";
import { guardAiRequest, openAiStream, readJsonRequest } from "@/lib/server/request-guard";

// POST /api/ai/chat  ChatRequest -> text/plain stream.
// Only the (validated, trimmed) user/assistant messages come from the client; the live context for the open view (or
// for a seeded question's subject, and the positions the investor allows) is built on the server.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOKENS = 800;
const TEMPERATURE = 0.3;

/**
 * Generations stop at a 120 s deadline (240 s for a reasoning model, lib/server/deepseek.ts); allow a little longer so
 * the error marker can be sent.
 */
export const maxDuration = 250;

export async function POST(request: Request): Promise<Response> {
  const denied = guardAiRequest(request, RATE_LIMITS.chat);
  if (denied) return denied;

  const body = await readJsonRequest(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseChatRequest(body.body);
  if (!parsed.ok) return jsonError(400, "bad_request", parsed.message);
  const { messages, lang, context } = parsed.data;

  let live: ContextResult;
  try {
    live = await buildChatContext(context);
  } catch (error) {
    return upstreamError("ai/chat", error);
  }
  if (!live.ok) return jsonError(live.status, live.code, live.message);

  return openAiStream(request, {
    messages: buildChatMessages({ lang, context: live.text, messages }),
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  });
}
