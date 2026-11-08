import type { Metadata } from "next";

import { Wordmark } from "@/components/ui/Wordmark";
import { requestMessages } from "@/lib/i18n/request";
import { MAX_ACCESS_PASSWORD_LENGTH } from "@/lib/server/env";
import { safeNextPath } from "@/lib/server/site-access";

import { UnlockForm } from "./UnlockForm";

// Unlock page of a private site (SITE_ACCESS=private). proxy.ts sends every visitor without a session here and
// redirects away from it on a public site or once the visitor is signed in, so it only renders when it is needed.

interface Props {
  searchParams: Promise<{ next?: string | string[] }>;
}

/** Titled in the reader's language, resolved the way the layout resolves it (the cookie, then Accept-Language). */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.access.pageTitle, robots: { index: false, follow: false } };
}

export default async function UnlockPage({ searchParams }: Props) {
  const { t } = await requestMessages();
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm rounded-sm border border-line bg-panel p-6">
        {/* The top bar hides the name on phones to save room; this page has room and no other chrome. */}
        <Wordmark alwaysShowName />
        <h1 className="mt-6 text-base font-medium text-fg">{t.access.title}</h1>
        <p className="mt-1.5 mb-5 text-sm text-fg-3">{t.access.body}</p>
        <UnlockForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} maxLength={MAX_ACCESS_PASSWORD_LENGTH} />
      </div>
    </main>
  );
}
