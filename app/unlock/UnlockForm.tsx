"use client";

import { Lock } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { ApiError, postJson } from "@/lib/api-client";
import { tpl } from "@/lib/format";

import { retryWait } from "./wait";

/**
 * Password form of the private-site unlock page. It signs in through the same endpoint as the AI unlock form and, on
 * success, loads the page the visitor asked for. `maxLength` is the longest password the server accepts.
 */
export function UnlockForm({ next, maxLength }: { next: string; maxLength: number }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const messageId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/auth/login", { password });
      setOpening(true);
      // A full page load, so the server renders the shell with the new session cookie from the start.
      window.location.replace(next);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      if (apiError?.status === 429) {
        const wait = retryWait(apiError.retryAfter);
        setMessage(wait.unit === "min" ? tpl(t.access.rateLimitedMinutes, { m: wait.value }) : tpl(t.access.rateLimited, { s: wait.value }));
      } else if (apiError?.status === 401) setMessage(t.access.wrongPassword);
      else if (apiError?.status === 400 || apiError?.status === 503) setMessage(t.access.unavailable);
      else setMessage(t.access.failed);
      setBusy(false);
      // Submitting disabled the button, which drops its focus to the page: return focus to the field, with a wrong
      // password selected so that typing replaces it.
      inputRef.current?.focus();
      if (apiError?.status === 401) inputRef.current?.select();
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label htmlFor={inputId} className="flex items-center gap-1.5 text-xs font-medium text-fg-2">
        <Lock aria-hidden className="size-3.5 text-accent" strokeWidth={1.75} />
        {t.access.password}
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="password"
          maxLength={maxLength}
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={message ? messageId : undefined}
          className="h-9 min-w-0 flex-1 rounded-xs border border-input-border bg-input-bg px-2.5 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="primary" className="h-9" disabled={!password || busy}>
          {opening ? t.access.opening : busy ? t.access.checking : t.access.submit}
        </Button>
      </div>
      <p id={messageId} role="alert" className="min-h-5 text-sm text-danger">
        {message}
      </p>
    </form>
  );
}
