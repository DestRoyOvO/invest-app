import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { StockView } from "@/components/stock/StockView";
import { requestMessages } from "@/lib/i18n/request";
import { symbolTitle } from "@/lib/names-zh";
import { normalizeSymbol } from "@/lib/symbols";

interface Props {
  params: Promise<{ symbol: string }>;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * "NVDA", or "英伟达 NVDA" in Chinese; StockView replaces it with the live title once the quote loads. A symbol that
 * cannot exist renders the not-found page and gets its title.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const { lang, t } = await requestMessages();
  const normalized = normalizeSymbol(safeDecode(symbol));
  return { title: normalized ? symbolTitle(normalized, lang) : t.help.notFound.title };
}

/**
 * The quote page. A symbol that cannot exist (not a plausible Yahoo symbol, such as "$$$" or 40 characters) answers 404
 * from here, without asking Yahoo. A well-formed symbol Yahoo does not know (ZZZZ) still answers 200 and shows
 * StockView's not-found view once /api/stock/<symbol> answers 404: looking it up while rendering would call Yahoo
 * outside the API routes' per-client rate limit and hold up every quote page.
 */
export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const raw = safeDecode(symbol);
  const normalized = normalizeSymbol(raw);
  if (!normalized) notFound();
  // StockView reads ?tab= and ?compare= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <StockView key={normalized} symbol={normalized} />
    </Suspense>
  );
}
