import type { Metadata } from "next";
import { Suspense } from "react";

import { ScreenerView } from "@/components/screener/ScreenerView";
import { screenerTitle } from "@/components/screener/titles";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: screenerTitle(tab === "discover" ? "discover" : "screener") };
}

/** EQS and MOST: the screener over the stock and ETF universes, and market-wide lists on ?tab=discover. */
export default function ScreenerPage() {
  return (
    <Suspense>
      <ScreenerView />
    </Suspense>
  );
}
