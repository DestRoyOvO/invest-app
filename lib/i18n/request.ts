// The reader's language on the server, resolved the way the root layout resolves it (the is_lang cookie, then the
// Accept-Language header), so generateMetadata titles each page in the language it renders in.
import "server-only";

import { cookies, headers } from "next/headers";

import { resolvePrefs } from "@/lib/prefs";
import type { Lang } from "@/types/api";

import { MESSAGES, type Messages } from "./messages";

export async function requestLang(): Promise<Lang> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  return resolvePrefs((name) => cookieStore.get(name)?.value, headerStore.get("accept-language")).lang;
}

/** The messages of the reader's language, with its language. */
export async function requestMessages(): Promise<{ lang: Lang; t: Messages }> {
  const lang = await requestLang();
  return { lang, t: MESSAGES[lang] };
}
