import type { Metadata } from "next";

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
  return <StockView key={raw} symbol={normalizeSymbol(raw)} rawInput={raw} />;
}
