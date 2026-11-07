// Contract of the shell's own endpoint. Conventions as in types/api.ts (raw numbers, null for missing, ISO times).
//
//   GET /api/market/board -> BoardResponse   (the 10 instruments of MARKET_BOARD for the ticker strip and status bar)

import type { BoardItem, MarketState } from "@/types/api";

export interface BoardResponse {
  /** When the server assembled this payload (it is cached for 10 seconds). */
  asOf: string;
  /** Market state of the US cash session, taken from ^GSPC. */
  marketState: MarketState | null;
  /** Indices, rates, FX, commodities and crypto in the order of MARKET_BOARD (lib/universe.ts). */
  board: BoardItem[];
  /**
   * "quotes_stale" when some quotes are older cached values because Yahoo failed; "sparklines" when some series are
   * missing; "board" when some instruments have no quote.
   */
  warnings: string[];
  /** The oldest fetchedAt among stale board quotes (ISO), or null when every quote is fresh. */
  quotesAsOf: string | null;
}
