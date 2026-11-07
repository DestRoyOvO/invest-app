"use client";

import Link from "next/link";

import { useT } from "@/components/providers/PrefsProvider";

export default function NotFound() {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="num text-sm tracking-[0.2em] text-fg-3">404</span>
      <h1 className="text-lg font-medium text-fg">{t.errors.notFound}</h1>
      <Link href="/" className="rounded-xs bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110">
        {t.nav.market}
      </Link>
    </main>
  );
}
