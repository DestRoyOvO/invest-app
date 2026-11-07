"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ApiError, fetchJson } from "@/lib/api-client";
import type { Prefs } from "@/lib/prefs";

import { PrefsProvider } from "./PrefsProvider";
import { UiProvider } from "./UiProvider";

const swrConfig = {
  fetcher: (url: string) => fetchJson(url),
  keepPreviousData: true,
  dedupingInterval: 5_000,
  errorRetryCount: 3,
  // Client errors (bad input, unknown symbol, auth) will not fix themselves: don't retry them.
  shouldRetryOnError: (error: unknown) => !(error instanceof ApiError && error.status >= 400 && error.status < 500),
};

export function Providers({ prefs, children }: { prefs: Prefs; children: ReactNode }) {
  return (
    <SWRConfig value={swrConfig}>
      <PrefsProvider initial={prefs}>
        <UiProvider>{children}</UiProvider>
      </PrefsProvider>
    </SWRConfig>
  );
}
