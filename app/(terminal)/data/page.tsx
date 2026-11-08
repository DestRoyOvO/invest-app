import type { Metadata } from "next";

import { DataView } from "@/components/data/DataView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.data.title };
}

export default function DataPage() {
  return <DataView />;
}
