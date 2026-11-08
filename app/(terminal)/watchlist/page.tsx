import type { Metadata } from "next";

import { WatchlistView } from "@/components/watchlist/WatchlistView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.watchlist.title };
}

export default function WatchlistPage() {
  return <WatchlistView />;
}
