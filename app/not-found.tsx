import type { Metadata } from "next";

import { NotFoundView } from "@/components/shell/NotFoundView";
import { TerminalShell } from "@/components/shell/TerminalShell";
import { requestMessages } from "@/lib/i18n/request";

/** The tab title in the reader's language, resolved the way the layout resolves it (cookie, then Accept-Language). */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.help.notFound.title };
}

/** Unknown URLs render inside the terminal shell, so the command bar, navigation and shortcuts stay at hand. */
export default function NotFound() {
  return (
    <TerminalShell>
      <NotFoundView />
    </TerminalShell>
  );
}
