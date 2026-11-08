import type { Metadata } from "next";
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

/** "NVDA", or "英伟达 NVDA" in Chinese; StockView replaces it with the live title once the quote loads. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const { lang, t } = await requestMessages();
  const normalized = normalizeSymbol(safeDecode(symbol));
  return { title: normalized ? symbolTitle(normalized, lang) : t.meta.quote };
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const raw = safeDecode(symbol);
  // StockView reads ?tab= and ?compare= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <StockView key={raw} symbol={normalizeSymbol(raw)} rawInput={raw} />
    </Suspense>
  );
}
