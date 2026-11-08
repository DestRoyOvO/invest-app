"use client";

import { Lock } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { aiStateOf, type AiState } from "@/components/shell/AiStatus";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { useAuthStatus } from "@/hooks/useApi";
import { ApiError, postJson } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";

import { waitText } from "./copy";

/** Why AI cannot be used on this deployment, in words a self-hoster can act on. */
export function AiOffNote({ state, className }: { state: Extract<AiState, "notConfigured" | "disabled">; className?: string }) {
  const { t } = usePrefs();
  return <p className={cn("px-3 py-3 text-sm text-fg-2", className)}>{state === "notConfigured" ? t.ai.notConfigured : t.ai.unavailable}</p>;
}

/**
 * The one unlock form, shown in the assistant drawer (and the news reader) wherever AI is used but locked; or a short
 * explanation when AI is off. The password field id is unique per form.
 */
export function AiGate({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const { t } = usePrefs();
  const { data, mutate } = useAuthStatus();
  const state = aiStateOf(data);
  const inputId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (state === "notConfigured" || state === "disabled") return <AiOffNote state={state} className={compact ? undefined : "px-4 py-6"} />;

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
      if (error instanceof ApiError && error.status === 429) setMessage(tpl(t.ai.rateLimited, { wait: waitText(error.retryAfter, t) }));
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
      <p className="text-sm text-fg-2">{t.ai.lockedBody}</p>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={inputId}>
          {t.ai.password}
        </label>
        <Input
          id={inputId}
          type="password"
          autoComplete="current-password"
          data-autofocus={autoFocus || undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t.ai.password}
          className="flex-1"
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

/** The compact locked state of an AI panel: one line and a button that opens the unlock form in the drawer. */
export function UnlockPrompt({ className }: { className?: string }) {
  const { t } = usePrefs();
  const { openChat, closeNews } = useUi();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3", className)}>
      <Lock aria-hidden className="size-4 shrink-0 text-warn" strokeWidth={1.75} />
      <p className="min-w-0 flex-1 text-sm text-fg-2">{t.ai.lockedPanel}</p>
      <Button
        size="sm"
        onClick={() => {
          closeNews();
          openChat();
        }}
      >
        {t.ai.unlockAi}
      </Button>
    </div>
  );
}
