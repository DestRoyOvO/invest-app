import type { Metadata } from "next";
import { Suspense } from "react";

import { StockView } from "@/components/stock/StockView";
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  return { title: normalizeSymbol(safeDecode(symbol)) ?? "Quote" };
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
