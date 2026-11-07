"use client";

import { Lock } from "lucide-react";
import { useState, type FormEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { aiStateOf } from "@/components/shell/AiStatus";
import { Button } from "@/components/ui/Button";
import { useAuthStatus } from "@/hooks/useApi";
import { ApiError, postJson } from "@/lib/api-client";
import { tpl } from "@/lib/format";

/** Shown wherever an AI feature is used but not available: unlock form, or a short explanation. */
export function AiGate({ compact = false }: { compact?: boolean }) {
  const { t } = usePrefs();
  const { data, mutate } = useAuthStatus();
  const state = aiStateOf(data);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (state === "notConfigured" || state === "disabled") {
    return <p className="px-3 py-4 text-sm text-fg-3">{state === "notConfigured" ? t.ai.notConfigured : t.ai.unavailable}</p>;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/auth/login", { password });
      setPassword("");
      await mutate();
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) setMessage(tpl(t.ai.rateLimited, { s: error.retryAfter ?? 60 }));
      else if (error instanceof ApiError && error.status === 401) setMessage(t.ai.wrongPassword);
      else setMessage(t.ai.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className={compact ? "space-y-2 p-3" : "space-y-3 px-4 py-6"}>
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <Lock aria-hidden className="size-4 text-warn" strokeWidth={1.75} />
        {t.ai.lockedTitle}
      </div>
      <p className="text-sm text-fg-3">{t.ai.lockedBody}</p>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="ai-password">
          {t.ai.password}
        </label>
        <input
          id="ai-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t.ai.password}
          className="h-8 min-w-0 flex-1 rounded-xs border border-input-border bg-input-bg px-2.5 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="primary" disabled={!password || busy}>
          {busy ? t.ai.unlocking : t.ai.unlock}
        </Button>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      ) : null}
    </form>
  );
}
