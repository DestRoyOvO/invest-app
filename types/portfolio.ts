// Contract for the portfolio package's endpoints (conventions as in types/api.ts: raw numbers, null for missing
// values, ISO timestamps).
//
//   GET /api/profiles?symbols=A,B   -> ProfilesResponse   (max 25 symbols; Yahoo profile fields for exposure grouping)

/** The profile fields portfolio exposure needs: Yahoo's sector and industry, the country and the trading currency. */
export interface HoldingProfile {
  symbol: string;
  name: string | null;
  /** Yahoo (Morningstar-style) sector name, e.g. "Consumer Cyclical"; null for funds and unknown symbols. */
  sector: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
}

export interface ProfilesResponse {
  asOf: string;
  /** By symbol, for the symbols Yahoo has a profile for. */
  profiles: Record<string, HoldingProfile>;
  /** Requested symbols without a profile (unknown to Yahoo, or failed upstream when `degraded`). */
  missing: string[];
  /** Some lookups failed upstream; the response is cached only briefly. */
  degraded: boolean;
}
