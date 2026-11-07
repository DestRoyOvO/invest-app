"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";

/** Error boundary for terminal pages: keeps the shell usable and offers a retry. */
export default function TerminalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="p-px">
      <div role="alert" className="flex flex-col items-center gap-3 bg-panel px-4 py-16 text-center">
        <AlertTriangle aria-hidden className="size-6 text-warn" strokeWidth={1.5} />
        <p className="text-sm text-fg-2">{t.common.error}</p>
        <Button variant="primary" onClick={reset}>
          {t.common.retry}
        </Button>
      </div>
    </div>
  );
}
