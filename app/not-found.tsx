import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { NotFoundView } from "@/components/shell/NotFoundView";
import { TerminalShell } from "@/components/shell/TerminalShell";
import { MESSAGES } from "@/lib/i18n/messages";
import { resolvePrefs } from "@/lib/prefs";

/** The tab title in the reader's language, resolved the way the layout resolves it (cookie, then Accept-Language). */
export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const { lang } = resolvePrefs((name) => cookieStore.get(name)?.value, headerStore.get("accept-language"));
  return { title: MESSAGES[lang].help.notFound.title };
}

/** Unknown URLs render inside the terminal shell, so the command bar, navigation and shortcuts stay at hand. */
export default function NotFound() {
  return (
    <TerminalShell>
      <NotFoundView />
    </TerminalShell>
  );
}
