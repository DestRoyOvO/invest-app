import type { Metadata } from "next";

import { NotFoundView } from "@/components/shell/NotFoundView";
import { requestMessages } from "@/lib/i18n/request";

/**
 * The not-found title in the reader's language. Next.js titles a notFound() page from the nearest not-found file, not
 * from the page's own metadata, so the quote page's not-found carries it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.help.notFound.title };
}

/**
 * notFound() on the quote page, for a symbol that cannot exist (see page.tsx): the terminal's not-found view, inside the
 * shell of app/(terminal)/layout.tsx.
 */
export default function QuoteNotFound() {
  return <NotFoundView />;
}
