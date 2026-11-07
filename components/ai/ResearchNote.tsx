"use client";

import { RefreshCw, Sparkles, Square } from "lucide-react";
import { useEffect } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { aiStateOf } from "@/components/shell/AiStatus";
import { Button } from "@/components/ui/Button";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { useAuthStatus } from "@/hooks/useApi";
import { useAiNote, type AiFailure } from "@/hooks/useAiStream";
import { cn } from "@/lib/cn";
import { formatTime, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import type { AnalyzeRequest } from "@/types/api";

import { AiGate } from "./AiGate";
import { Markdown } from "./Markdown";

function failureText(failure: AiFailure, t: Messages): string {
  switch (failure.kind) {
    case "rate_limited":
      return tpl(t.ai.rateLimited, { s: failure.retryAfter ?? 60 });
    case "interrupted":
      return t.ai.interrupted;
    case "unavailable":
      return t.ai.unavailable;
    case "not_configured":
      return t.ai.notConfigured;
    case "locked":
      return t.ai.lockedTitle;
    default:
      return t.ai.failed;
  }
}

interface ResearchNoteBodyProps {
  request: AnalyzeRequest | null;
  /** Disable generation until the page's data has loaded. */
  ready?: boolean;
  className?: string;
}

/** The note itself (no panel chrome), reused by the news drawer. */
export function ResearchNoteBody({ request, ready = true, className }: ResearchNoteBodyProps) {
  const { t, lang } = usePrefs();
  const { data: auth, mutate: refreshAuth } = useAuthStatus();
  const aiState = aiStateOf(auth);
  const { text, status, failure: lastFailure, generatedAt, truncated, start, stop } = useAiNote(request);
  // A 401 from an expired session shows the unlock form until the session is back; after unlocking it no longer applies.
  const failure = lastFailure?.kind === "locked" && aiState === "available" ? null : lastFailure;
  // The cached status may still say "available" when the session has just expired: refresh it so the gate appears.
  useEffect(() => {
    if (lastFailure?.kind === "locked") void refreshAuth();
  }, [lastFailure, refreshAuth]);

  if (aiState === "locked" || aiState === "notConfigured" || aiState === "disabled" || failure?.kind === "locked") {
    return <AiGate />;
  }

  const streaming = status === "streaming";
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {streaming ? (
          <Button size="sm" onClick={stop}>
            <Square aria-hidden className="size-3" strokeWidth={2} />
            {t.ai.stop}
          </Button>
        ) : (
          <Button size="sm" variant={text ? "secondary" : "primary"} onClick={start} disabled={!request || !ready}>
            {text ? <RefreshCw aria-hidden className="size-3.5" strokeWidth={1.75} /> : <Sparkles aria-hidden className="size-3.5" strokeWidth={1.75} />}
            {text ? t.ai.regenerate : t.ai.generate}
          </Button>
        )}
        <span className="min-w-0 truncate text-xs text-fg-3" aria-live="polite">
          {streaming ? t.ai.generating : generatedAt ? tpl(t.ai.generatedAt, { time: formatTime(generatedAt, lang) }) : t.ai.idle}
        </span>
      </div>
      <div className="px-3 py-3" aria-busy={streaming}>
        {text ? <Markdown text={text} /> : null}
        {truncated && !streaming ? <p className="mt-2 text-xs text-fg-3">{t.ai.truncated}</p> : null}
        {streaming && !text ? <p className="text-sm text-fg-3">{t.ai.generating}</p> : null}
        {status === "error" && failure ? (
          <p role="alert" className="mt-2 text-sm text-warn">
            {failureText(failure, t)}
          </p>
        ) : null}
      </div>
      {text ? <p className="mt-auto border-t border-line px-3 py-2 text-xs text-fg-3">{t.ai.disclaimer}</p> : null}
    </div>
  );
}

interface ResearchNoteProps extends ResearchNoteBodyProps {
  title: string;
}

export function ResearchNote({ title, request, ready, className }: ResearchNoteProps) {
  return (
    <Panel title={title} actions={<PanelMeta>DeepSeek</PanelMeta>} className={className}>
      <ResearchNoteBody request={request} ready={ready} className="h-full" />
    </Panel>
  );
}
