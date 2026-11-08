"use client";

import { Copy, History, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button, IconButton } from "@/components/ui/Button";
import type { ChatTurn } from "@/hooks/useAiStream";
import type { Conversation } from "@/lib/ai-store";
import type { Suggestion } from "@/lib/ai-suggestions";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { plural } from "@/lib/i18n/plural";

import { failureText } from "./copy";
import { Markdown } from "./Markdown";

const questionClass =
  "inline-flex min-h-7 max-w-full items-center rounded-xs border border-line-2 px-2.5 py-1 text-left text-sm text-fg-2 transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3 max-sm:min-h-10";

/** Clickable questions (starters or follow-ups); a click sends the question with its intent. */
export function QuestionList({ title, items, onAsk, disabled = false, wrap = false }: { title: string; items: readonly Suggestion[]; onAsk: (item: Suggestion) => void; disabled?: boolean; wrap?: boolean }) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <div>
      <p id={headingId} className="col-head mb-1.5">
        {title}
      </p>
      <ul aria-labelledby={headingId} className={cn("flex gap-1.5", wrap ? "flex-wrap" : "flex-col items-start")}>
        {items.map((item) => (
          <li key={item.text} className="max-w-full">
            <button type="button" className={questionClass} onClick={() => onAsk(item)} disabled={disabled}>
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A line marking that the questions below were asked from another page. */
export function ContextDivider({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-2 py-1 text-xs text-fg-3">
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span aria-hidden>{label}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

interface TurnProps {
  turn: ChatTurn;
  /** The last turn of the conversation: it gets Regenerate or Retry. */
  last: boolean;
  busy: boolean;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
  onRetry: () => void;
}

export function ChatTurnView({ turn, last, busy, onCopy, onRegenerate, onRetry }: TurnProps) {
  const { t } = usePrefs();
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xs bg-hover px-3 py-2 text-sm whitespace-pre-wrap text-fg">{turn.content}</div>
      </div>
    );
  }
  if (turn.failure) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="min-w-0 flex-1 text-sm text-warn">
          {failureText(turn.failure, t)}
        </p>
        {last && turn.failure.kind !== "locked" ? (
          <Button size="sm" onClick={onRetry} disabled={busy} aria-label={t.ai.chat.retryQuestion}>
            <RotateCcw aria-hidden className="size-3.5" strokeWidth={1.75} />
            {t.ai.retry}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      {turn.content ? <Markdown text={turn.content} /> : <span className="text-sm text-fg-2">{t.ai.generating}</span>}
      {turn.truncated ? <p className="mt-1.5 text-xs text-fg-3">{t.ai.truncated}</p> : null}
      {!turn.streaming && turn.content ? (
        <div className="mt-1 flex items-center gap-0.5">
          <IconButton size="sm" label={t.ai.chat.copyAnswer} icon={<Copy className="size-3.5" strokeWidth={1.75} />} onClick={() => onCopy(turn.content)} />
          {last ? (
            <IconButton size="sm" label={t.ai.chat.regenerateAnswer} icon={<RefreshCw className="size-3.5" strokeWidth={1.75} />} onClick={onRegenerate} disabled={busy} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface HistoryMenuProps {
  conversations: readonly Conversation[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onClear: () => void;
}

/**
 * The saved conversations as a disclosure menu in the drawer toolbar. Escape and a click outside close the menu
 * only (the drawer stays open); choosing a conversation opens it.
 */
export function HistoryMenu({ conversations, currentId, onOpen, onClear }: HistoryMenuProps) {
  const { t, lang } = usePrefs();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes only the menu. Listening in the capture phase on window runs before the drawer's document listener,
    // and stopping the event there keeps the drawer open (the same pattern as HoverCard).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={wrapperRef} className="relative">
      <Button ref={buttonRef} size="sm" variant="ghost" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((value) => !value)}>
        <History aria-hidden className="size-3.5" strokeWidth={1.75} />
        {t.ai.chat.history}
        {conversations.length > 0 ? <span className="num text-fg-3">{conversations.length}</span> : null}
      </Button>
      {open ? (
        <div id={menuId} className="absolute top-full left-0 z-20 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xs border border-line-2 bg-panel shadow-xl">
          <p className="col-head border-b border-line px-3 py-2">{t.ai.chat.historyTitle}</p>
          {conversations.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-2">{t.ai.chat.historyEmpty}</p>
          ) : (
            <>
              <ul className="max-h-72 overflow-y-auto py-1">
                {conversations.map((conversation) => {
                  const current = conversation.id === currentId;
                  return (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        aria-current={current ? "true" : undefined}
                        onClick={() => {
                          onOpen(conversation.id);
                          close();
                        }}
                        className={cn("block w-full px-3 py-2 text-left transition-colors hover:bg-hover", current && "bg-panel-2")}
                      >
                        <span className="block truncate text-sm text-fg">{conversation.title}</span>
                        <span className="num block text-xs text-fg-3">
                          {formatRelativeTime(conversation.updatedAt, lang)} · {plural(t.ai.chat.messageCount, conversation.messages.length)}
                          {current ? ` · ${t.ai.chat.current}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-line p-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onClear();
                    close();
                  }}
                >
                  {t.ai.chat.clearHistory}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
