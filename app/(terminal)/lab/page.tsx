import type { Metadata } from "next";

import { LabView } from "@/components/lab/LabView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.lab.title, description: t.meta.labDescription };
}

export default function LabPage() {
  return <LabView />;
}
