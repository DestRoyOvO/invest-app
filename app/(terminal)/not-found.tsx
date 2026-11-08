import type { Metadata } from "next";

import { NotFoundView } from "@/components/shell/NotFoundView";
import { requestMessages } from "@/lib/i18n/request";

/**
 * The tab title of notFound() inside a terminal page (/sector/no-such-sector), in the reader's language. A page that
 * calls notFound() before it streams renders this boundary in its place, and its title comes from the layouts and this
 * file, not from the page's own generateMetadata: without it the server sent the site's default title.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.help.notFound.title };
}

/** notFound() inside a terminal page: the shell around it comes from app/(terminal)/layout.tsx. */
export default function TerminalNotFound() {
  return <NotFoundView />;
}
