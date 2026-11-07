"use client";

import { Lock } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { ApiError, postJson } from "@/lib/api-client";
import { tpl } from "@/lib/format";

/**
 * Password form of the private-site unlock page. It signs in through the same endpoint as the AI unlock form and, on
 * success, loads the page the visitor asked for.
 */
export function UnlockForm({ next }: { next: string }) {
  const t = useT();
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
      if (error instanceof ApiError && error.status === 429) setMessage(tpl(t.access.rateLimited, { s: error.retryAfter ?? 60 }));
      else if (error instanceof ApiError && error.status === 401) setMessage(t.access.wrongPassword);
      else if (error instanceof ApiError && (error.status === 400 || error.status === 503)) setMessage(t.access.unavailable);
      else setMessage(t.access.failed);
      setBusy(false);
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
          id={inputId}
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={message ? messageId : undefined}
          className="h-9 min-w-0 flex-1 rounded-xs border border-line-2 bg-canvas px-2.5 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
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
