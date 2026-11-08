import { getBoard, uncachedBoardCalls } from "@/lib/server/board";
import { extraUnits } from "@/lib/server/charging";
import { jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { isSessionActive } from "@/lib/server/yahoo";

/** Shared-cache lifetime while stale quotes are shown, so the board recovers quickly once Yahoo answers again. */
const STALE_CACHE_SECONDS = 5;

/** GET /api/market/board -> BoardResponse (types/shell.ts): the ticker strip and status bar data. */
export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;
  // One unit per uncached Yahoo call beyond the first (the quote batch and each sparkline), like /api/sparklines.
  const charged = chargePublicRequest(request, extraUnits(uncachedBoardCalls()));
  if (charged) return charged;

  try {
    const board = await getBoard();
    const cacheSeconds = board.warnings.includes("quotes_stale") ? STALE_CACHE_SECONDS : isSessionActive(board.marketState) ? 10 : 60;
    return jsonOk(board, { cacheSeconds });
  } catch (error) {
    return upstreamError("api/market/board", error);
  }
}
