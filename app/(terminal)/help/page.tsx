import type { Metadata } from "next";

import { HelpView } from "@/components/shell/HelpView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.help.page.title };
}

export default function HelpPage() {
  return <HelpView />;
}
