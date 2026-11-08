import type { Metadata } from "next";

import { MarketsView } from "@/components/markets/MarketsView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.markets.title };
}

export default function MarketsPage() {
  return <MarketsView />;
}
