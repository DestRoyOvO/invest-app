import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { Wordmark } from "@/components/shell/TopBar";
import { MESSAGES } from "@/lib/i18n/messages";
import { resolvePrefs } from "@/lib/prefs";
import { MAX_ACCESS_PASSWORD_LENGTH } from "@/lib/server/env";
import { safeNextPath } from "@/lib/server/site-access";

import { UnlockForm } from "./UnlockForm";

// Unlock page of a private site (SITE_ACCESS=private). proxy.ts sends every visitor without a session here and
// redirects away from it on a public site or once the visitor is signed in, so it only renders when it is needed.

interface Props {
  searchParams: Promise<{ next?: string | string[] }>;
}

async function messages() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  return MESSAGES[resolvePrefs((name) => cookieStore.get(name)?.value, headerStore.get("accept-language")).lang];
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await messages()).access.pageTitle, robots: { index: false, follow: false } };
}

export default async function UnlockPage({ searchParams }: Props) {
  const t = await messages();
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm rounded-sm border border-line bg-panel p-6">
        <div className="flex items-center gap-2">
          <Wordmark />
          {/* Wordmark hides the name on phones to leave room in the top bar; this page has room and no other chrome. */}
          <span className="num text-sm font-semibold tracking-[0.2em] text-fg sm:hidden">INVESTSEEK</span>
        </div>
        <h1 className="mt-6 text-base font-medium text-fg">{t.access.title}</h1>
        <p className="mt-1.5 mb-5 text-sm text-fg-3">{t.access.body}</p>
        <UnlockForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} maxLength={MAX_ACCESS_PASSWORD_LENGTH} />
      </div>
    </main>
  );
}
