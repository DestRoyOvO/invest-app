"use client";

import { Copy, NotebookPen, RefreshCw, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { aiStateOf } from "@/components/shell/AiStatus";
import { AiChip } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useAuthStatus } from "@/hooks/useApi";
import { useAiNote, useCachedData } from "@/hooks/useAiStream";
import { useLocalStore } from "@/hooks/useLocalStore";
import { assetClassOf, noteOutline } from "@/lib/ai-notes";
import { aiPrefsStore } from "@/lib/ai-store";
import { cn } from "@/lib/cn";
import { formatShortDate, formatTime, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { addNoteEntry } from "@/lib/notes";
import type { AnalyzeRequest, Lang, StockDetail } from "@/types/api";

import { AiGate, AiOffNote, UnlockPrompt } from "./AiGate";
import { failureText } from "./copy";
import { Markdown } from "./Markdown";

const LIVE_STATES = new Set(["REGULAR", "PRE", "POST", "PREPRE", "POSTPOST"]);

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "Generated 14:05 · DeepSeek", with the date when the note is from another day. */
function generatedLine(generatedAt: number, t: Messages, lang: Lang): string {
  const time = formatTime(generatedAt, lang);
  return sameDay(generatedAt, Date.now()) ? tpl(t.ai.generatedAt, { time }) : tpl(t.ai.generatedOn, { date: formatShortDate(generatedAt, lang), time });
}

/** "Data as of 15:58", or "Data as of the close on Nov 6" outside the session. */
export function dataLine(dataAsOf: string | null, marketState: string | null, t: Messages, lang: Lang): string | null {
  if (!dataAsOf) return null;
  if (marketState && LIVE_STATES.has(marketState) && sameDay(Date.parse(dataAsOf), Date.now())) return tpl(t.ai.dataAt, { time: formatTime(dataAsOf, lang) });
  return tpl(t.ai.dataAtClose, { date: formatShortDate(dataAsOf, lang, "America/New_York") });
}

/** The symbol a note can be saved to (quote-page notes and move explainers). */
function noteSymbol(request: AnalyzeRequest | null): string | null {
  return request && (request.kind === "stock" || request.kind === "move") ? request.symbol : null;
}

interface ResearchNoteBodyProps {
  request: AnalyzeRequest | null;
  /** Disable generation until the page's data has loaded. */
  ready?: boolean;
  className?: string;
  /**
   * How a locked AI shows up: "form" renders the unlock form in place (the news reader), "button" a compact prompt that
   * opens the form in the assistant drawer (the note panels, so the page has one password field, not several).
   */
  gate?: "form" | "button";
  /** Cap the note's height and scroll inside it (panels on a page; drawers scroll on their own). */
  capHeight?: boolean;
  /** Accessible name of the scrolling note region. */
  label?: string;
}

/** The note itself (no panel chrome), reused by the news drawer. */
export function ResearchNoteBody({ request, ready = true, className, gate = "form", capHeight = false, label }: ResearchNoteBodyProps) {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const { data: auth, mutate: refreshAuth } = useAuthStatus();
  const aiState = aiStateOf(auth);
  const { includePositions } = useLocalStore(aiPrefsStore);
  // A portfolio scan sends positions only while the investor allows it (the chat footer's "Include my positions").
  const effective = useMemo<AnalyzeRequest | null>(() => {
    if (request?.kind !== "watchlist" || includePositions || !request.positions) return request;
    const rest = { ...request };
    delete rest.positions;
    return rest;
  }, [request, includePositions]);
  const note = useAiNote(effective);
  const { text, status, failure: lastFailure, generatedAt, dataAsOf, marketState, reused, truncated, start, stop } = note;
  const symbol = noteSymbol(request);
  const detail = useCachedData<StockDetail>(symbol ? `/api/stock/${encodeURIComponent(symbol)}` : null);
  const [savedText, setSavedText] = useState<string | null>(null);
  // A 401 from an expired session shows the unlock prompt until the session is back; after unlocking it no longer applies.
  const failure = lastFailure?.kind === "locked" && aiState === "available" ? null : lastFailure;

  // The cached status may still say "available" when the session has just expired: refresh it so the gate appears.
  useEffect(() => {
    if (lastFailure?.kind === "locked") void refreshAuth();
  }, [lastFailure, refreshAuth]);

  if (aiState === "notConfigured" || aiState === "disabled") return <AiOffNote state={aiState} className={className} />;
  if (aiState === "locked" || failure?.kind === "locked") return gate === "button" ? <UnlockPrompt className={className} /> : <AiGate compact />;

  const streaming = status === "streaming";
  const disabled = !effective || !ready;

  if (!text && !streaming && status !== "error") {
    const asset = request?.kind === "stock" ? assetClassOf(detail?.quote.quoteType) : "equity";
    const outline = request ? noteOutline(request.kind, asset).map((key) => t.ai.sections[key]) : [];
    return (
      <div className={cn("flex flex-col items-start gap-2.5 px-3 py-3", className)}>
        <p className="text-sm text-fg-2">{t.ai.idle}</p>
        {outline.length > 0 ? <p className="text-xs text-fg-3">{tpl(t.ai.covers, { sections: outline.join(" · ") })}</p> : null}
        <Button size="sm" onClick={() => void start(false)} disabled={disabled}>
          <AiChip tone="current" />
          {t.ai.generate}
        </Button>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: t.ai.copied });
    } catch {
      toast.show({ message: t.ai.copyFailed });
    }
  };

  const save = () => {
    if (!symbol) return;
    addNoteEntry(symbol, { text, price: detail?.quote.price ?? null, kind: "ai" });
    setSavedText(text);
    toast.show({ message: tpl(t.ai.savedToNotes, { symbol }) });
  };

  const meta = [generatedAt && !streaming ? generatedLine(generatedAt, t, lang) : null, !streaming ? dataLine(dataAsOf, marketState, t, lang) : null].filter(Boolean).join(" · ");

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn("px-3 py-3", capHeight && "max-h-[min(70vh,720px)] overflow-y-auto")}
        aria-busy={streaming}
        {...(capHeight ? { tabIndex: 0, role: "region", "aria-label": tpl(t.ai.noteRegion, { title: label ?? t.ai.chat.title }) } : {})}
      >
        {status === "error" && failure ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p role="alert" className="min-w-0 flex-1 text-sm text-warn">
              {failureText(failure, t)}
            </p>
            <Button size="sm" onClick={() => void start(false)} disabled={disabled}>
              <RotateCcw aria-hidden className="size-3.5" strokeWidth={1.75} />
              {t.ai.retry}
            </Button>
          </div>
        ) : null}
        {text ? <Markdown text={text} /> : null}
        {streaming && !text ? <p className="text-sm text-fg-2">{t.ai.generating}</p> : null}
        {truncated && !streaming ? <p className="mt-2 text-xs text-fg-3">{t.ai.truncated}</p> : null}
      </div>
      {text || streaming ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
          {streaming ? (
            <Button size="sm" onClick={stop}>
              <Square aria-hidden className="size-3" strokeWidth={2} />
              {t.ai.stop}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void start(true)} disabled={disabled}>
              <RefreshCw aria-hidden className="size-3.5" strokeWidth={1.75} />
              {t.ai.regenerate}
            </Button>
          )}
          {text && !streaming ? <IconButton size="sm" label={t.ai.copy} icon={<Copy className="size-3.5" strokeWidth={1.75} />} onClick={() => void copy()} /> : null}
          {symbol && text && !streaming ? (
            <Button size="sm" variant="ghost" onClick={save} disabled={savedText === text}>
              <NotebookPen aria-hidden className="size-3.5" strokeWidth={1.75} />
              {savedText === text ? t.ai.saved : t.ai.saveToNotes}
            </Button>
          ) : null}
          <span className="num ml-auto min-w-0 truncate text-xs text-fg-3" aria-live="polite">
            {streaming ? t.ai.generating : meta}
          </span>
        </div>
      ) : null}
      {reused && !streaming ? <p className="px-3 pb-2 text-xs text-fg-3">{t.ai.reused}</p> : null}
      {text ? <p className="border-t border-line px-3 py-2 text-xs text-fg-3">{t.ai.disclaimer}</p> : null}
    </div>
  );
}

interface ResearchNoteProps extends Omit<ResearchNoteBodyProps, "gate" | "capHeight" | "label"> {
  title: string;
}

export function ResearchNote({ title, request, ready, className }: ResearchNoteProps) {
  return (
    <Panel title={title} code="AI" actions={<PanelMeta>DeepSeek</PanelMeta>} className={className}>
      <ResearchNoteBody request={request} ready={ready} gate="button" capHeight label={title} />
    </Panel>
  );
}
