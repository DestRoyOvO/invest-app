import type { Metadata } from "next";

import { AlertsView } from "@/components/alerts/AlertsView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.alerts.title };
}

export default function AlertsPage() {
  return <AlertsView />;
}
