"use client";

import { Lock, Plus, SendHorizontal, Square } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { aiStateOf } from "@/components/shell/AiStatus";
import { Button, IconButton } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { controlClass } from "@/components/ui/Field";
import { SkeletonRows } from "@/components/ui/States";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { useAuthStatus } from "@/hooks/useApi";
import { useAiChat, useCachedData } from "@/hooks/useAiStream";
import { useHoldings } from "@/hooks/useHoldings";
import { useLocalStore } from "@/hooks/useLocalStore";
import { useWatchlist } from "@/hooks/useWatchlist";
import { chatRequestContext, contextRef, pageContextFromPath } from "@/lib/ai-request";
import { aiPrefsStore, clearChatHistory, restoreChatHistory, sanitizeIntent, setIncludePositions } from "@/lib/ai-store";
import { followUpQuestions, suggestedQuestions, type Suggestion, type SuggestionData } from "@/lib/ai-suggestions";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import type { ChatIntentInput, MarketOverview, StockDetail } from "@/types/api";

import { AiGate } from "./AiGate";
import { ChatTurnView, ContextDivider, HistoryMenu, QuestionList } from "./ChatParts";
import { lockAi } from "./lock";

/** Within this many pixels of the bottom, new text keeps the log scrolled down; further up, the reader stays put. */
const NEAR_BOTTOM_PX = 48;

export function ChatDrawer() {
  const { t, lang } = usePrefs();
  const toast = useToast();
  const { chatOpen, closeChat, chatSeed, clearChatSeed } = useUi();
  const pathname = usePathname();
  const { symbols: watchlist } = useWatchlist();
  const { holdings } = useHoldings();
  const { data: auth, mutate: refreshAuth } = useAuthStatus();
  const aiState = aiStateOf(auth);
  const { includePositions } = useLocalStore(aiPrefsStore);
  const page = useMemo(() => pageContextFromPath(pathname ?? "/"), [pathname]);
  const ref = useMemo(() => contextRef(page, lang, t.ai.chat.contexts), [page, lang, t]);
  const buildContext = useCallback(
    (intent?: ChatIntentInput) => chatRequestContext({ page, watchlist, holdings, includePositions, intent }),
    [page, watchlist, holdings, includePositions],
  );
  const chat = useAiChat({ lang, page: ref, buildContext });
  const { turns, busy } = chat;
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  // Page-aware questions come from data the page already loaded (read from the SWR cache, never fetched here).
  const stock = useCachedData<StockDetail>(page.view === "stock" && page.symbol ? `/api/stock/${encodeURIComponent(page.symbol)}` : null);
  const overview = useCachedData<MarketOverview>("/api/market/overview");
  const hasHoldings = Object.keys(holdings).length > 0;
  const quote = stock?.quote;
  const suggestionData: SuggestionData = {
    page,
    lang,
    live: (quote?.marketState ?? overview?.marketState) === "REGULAR",
    changePercent: quote?.changePercent ?? null,
    relativeVolume: quote?.volume && quote.avgVolume ? quote.volume / quote.avgVolume : null,
    nextEarningsDate: quote?.nextEarningsDate ?? null,
    held: page.symbol ? Boolean(holdings[page.symbol]) : false,
    hasPositions: hasHoldings && includePositions,
    now: new Date(),
  };
  const last = turns[turns.length - 1];
  const answered = last?.role === "assistant" && !last.failure && !last.streaming && Boolean(last.content);
  const starters = turns.length === 0 ? suggestedQuestions(suggestionData, t.ai.suggest) : [];
  const followUps = answered ? followUpQuestions(suggestionData, t.ai.suggest, turns.filter((turn) => turn.role === "user").map((turn) => turn.content)) : [];

  const { send } = chat;
  const ask = useCallback(
    (text: string, intent?: ChatIntentInput) => {
      nearBottom.current = true;
      send(text, intent);
    },
    [send],
  );

  // A seeded question (the command bar's "?question", "Why is it moving?" buttons): send it once the drawer is open,
  // AI is usable and no answer is streaming, with its intent so the server loads the matching data.
  useEffect(() => {
    if (!chatOpen || !chatSeed || aiState !== "available" || busy) return;
    const seed = chatSeed;
    const id = window.setTimeout(() => {
      clearChatSeed();
      ask(seed.text, sanitizeIntent(seed.intent));
    }, 0);
    return () => window.clearTimeout(id);
  }, [chatOpen, chatSeed, aiState, busy, clearChatSeed, ask]);

  // An expired session answers 401: refresh the status so the unlock form replaces the chat.
  const lastFailure = last?.failure?.kind;
  useEffect(() => {
    if (lastFailure === "locked") void refreshAuth();
  }, [lastFailure, refreshAuth]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [turns]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
  };

  const submit = () => {
    if (!input.trim() || busy) return;
    ask(input);
    setInput("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      submit();
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: t.ai.copied });
    } catch {
      toast.show({ message: t.ai.copyFailed });
    }
  };

  const clearHistory = () => {
    const before = clearChatHistory();
    chat.newChat();
    toast.show({ message: t.ai.chat.historyCleared, action: { label: t.ai.chat.undo, onAction: () => restoreChatHistory(before) } });
  };

  const lock = async () => {
    try {
      await lockAi();
      await refreshAuth();
      toast.show({ message: t.ai.lockDone });
    } catch {
      toast.show({ message: t.ai.lockFailed });
    }
  };

  const target = page.view === "stock" || page.view === "sector" ? ref.label : page.view === "watchlist" ? (page.portfolio ? t.ai.chat.about.portfolio : t.ai.chat.about.watchlist) : t.ai.chat.about.market;
  // Chinese text sets Latin words such as tickers off with spaces.
  const welcomeTarget = lang === "zh" && /^[\x20-\x7e]+$/.test(target) ? ` ${target} ` : target;
  const available = aiState === "available";
  const canLock = available && auth?.authRequired === true && auth.authenticated;

  return (
    <Drawer
      open={chatOpen}
      onClose={closeChat}
      title={t.ai.chat.title}
      footer={
        available ? (
          <form onSubmit={onSubmit} className="space-y-2 p-3">
            <div className="flex items-end gap-2">
              <label htmlFor="chat-input" className="sr-only">
                {t.ai.chat.placeholder}
              </label>
              <textarea
                id="chat-input"
                data-autofocus
                rows={2}
                value={input}
                maxLength={2000}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t.ai.chat.placeholder}
                className={cn(controlClass, "min-h-[2.75rem] flex-1 resize-none px-2.5 py-2 text-sm")}
              />
              {busy ? (
                <IconButton label={t.ai.stop} icon={<Square className="size-3.5" strokeWidth={2} />} onClick={chat.stop} />
              ) : (
                <IconButton label={t.ai.chat.send} icon={<SendHorizontal className="size-4" strokeWidth={1.75} />} type="submit" disabled={!input.trim()} />
              )}
            </div>
            <p className="num truncate text-xs text-fg-3">{tpl(t.ai.chat.context, { ctx: ref.label })}</p>
            {hasHoldings ? (
              <Switch
                checked={includePositions}
                onCheckedChange={setIncludePositions}
                label={t.ai.chat.includePositions}
                description={includePositions ? t.ai.chat.positionsOn : t.ai.chat.positionsOff}
                className="max-sm:min-h-10"
              />
            ) : null}
          </form>
        ) : null
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {available ? (
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
            <HistoryMenu conversations={chat.conversations} currentId={chat.conversationId} onOpen={chat.openConversation} onClear={clearHistory} />
            <Button size="sm" variant="ghost" onClick={chat.newChat} disabled={busy || turns.length === 0} className="max-sm:h-10">
              <Plus aria-hidden className="size-3.5" strokeWidth={1.75} />
              {t.ai.chat.clear}
            </Button>
            {canLock ? (
              <Button size="sm" variant="ghost" onClick={() => void lock()} className="ml-auto max-sm:h-10">
                <Lock aria-hidden className="size-3.5" strokeWidth={1.75} />
                {t.ai.lock}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          {aiState === "unknown" ? (
            <SkeletonRows rows={3} />
          ) : available ? (
            <div className="space-y-4 p-3">
              {turns.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-fg-2">{tpl(t.ai.chat.welcome, { ctx: welcomeTarget })}</p>
                  <QuestionList title={t.ai.chat.suggestions} items={starters} onAsk={(item: Suggestion) => ask(item.text, item.intent)} disabled={busy} />
                </div>
              ) : null}
              <div role="log" aria-live="polite" aria-busy={busy} aria-label={t.ai.chat.title} className="space-y-4 empty:hidden">
                {turns.map((turn, index) => {
                  const previousQuestion = turn.role === "user" ? turns.slice(0, index).reverse().find((t2) => t2.role === "user") : undefined;
                  const moved = previousQuestion?.context && turn.context && previousQuestion.context.key !== turn.context.key;
                  return (
                    <div key={turn.id} className="space-y-4">
                      {moved && turn.context ? <ContextDivider label={tpl(t.ai.chat.nowViewing, { ctx: turn.context.label })} /> : null}
                      <ChatTurnView turn={turn} last={index === turns.length - 1} busy={busy} onCopy={(text) => void copy(text)} onRegenerate={chat.regenerate} onRetry={chat.retry} />
                    </div>
                  );
                })}
              </div>
              {answered ? <QuestionList title={t.ai.chat.followUps} items={followUps} onAsk={(item) => ask(item.text, item.intent)} disabled={busy} wrap /> : null}
              {turns.some((turn) => turn.role === "assistant" && !turn.failure && turn.content) ? <p className="text-xs text-fg-3">{t.ai.disclaimer}</p> : null}
            </div>
          ) : (
            <AiGate autoFocus />
          )}
        </div>
      </div>
    </Drawer>
  );
}
