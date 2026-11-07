import "server-only";

import type { AnalystActivity, EarningsDetail } from "@/types/earnings";

// Earnings and analyst data for one symbol (contract in types/earnings.ts).
// Placeholder: the events-calendar work package implements both getters with one cached quoteSummary call each
// (earnings, earningsHistory, earningsTrend, calendarEvents; recommendationTrend, upgradeDowngradeHistory, financialData).
// Callers must treat null as "not available" (funds, indices and unknown symbols also return null).

export async function getEarningsDetail(symbol: string): Promise<EarningsDetail | null> {
  void symbol;
  return null;
}

export async function getAnalystActivity(symbol: string): Promise<AnalystActivity | null> {
  void symbol;
  return null;
}
