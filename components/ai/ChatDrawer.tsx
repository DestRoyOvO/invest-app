"use client";

import { Eraser, SendHorizontal, Square } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { aiStateOf } from "@/components/shell/AiStatus";
import { Button, IconButton } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { useAuthStatus } from "@/hooks/useApi";
import { AiStreamFailure, failureFromError, failureFromStreamCode, readAiStream } from "@/hooks/useAiStream";
import { useWatchlist } from "@/hooks/useWatchlist";
import { postJson } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { normalizeSymbol } from "@/lib/symbols";
import { getSector } from "@/lib/universe";
import type { ChatRequest, Lang, SectorKey } from "@/types/api";

import { AiGate } from "./AiGate";
import { Markdown } from "./Markdown";

interface UiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Error notices are shown but never sent back to the model. */
  uiOnly?: boolean;
}

type ChatContext = ChatRequest["context"] & { symbols?: string[] };

function contextFromPath(pathname: string, watchlist: string[]): ChatContext {
  const stock = /^\/stock\/([^/]+)/.exec(pathname);
  if (stock) {
    const symbol = normalizeSymbol(decodeURIComponent(stock[1]));
    if (symbol) return { view: "stock", symbol };
  }
  const sector = /^\/sector\/([^/]+)/.exec(pathname);
  if (sector && getSector(sector[1])) return { view: "sector", sector: sector[1] as SectorKey };
  if (pathname.startsWith("/watchlist")) return { view: "watchlist", symbols: watchlist.slice(0, 50) };
  return { view: "market" };
}

function contextLabel(ctx: ChatContext, t: Messages, lang: Lang): string {
  if (ctx.view === "stock" && ctx.symbol) return ctx.symbol;
  if (ctx.view === "sector" && ctx.sector) return getSector(ctx.sector)?.label[lang] ?? ctx.sector;
  if (ctx.view === "watchlist") return t.nav.watchlist;
  return t.nav.market;
}

let nextId = 1;

export function ChatDrawer() {
  const { t, lang } = usePrefs();
  const { chatOpen, closeChat, chatSeed, clearChatSeed } = useUi();
  const pathname = usePathname();
  const { symbols: watchlist } = useWatchlist();
  const { data: auth } = useAuthStatus();
  const aiState = aiStateOf(auth);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const context = contextFromPath(pathname, watchlist);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      const userMessage: UiMessage = { id: nextId++, role: "user", content };
      const assistantId = nextId++;
      const history = [...messages, userMessage].filter((m) => !m.uiOnly && m.content).slice(-10);
      setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
      setInput("");
      setBusy(true);
      const controller = new AbortController();
      controllerRef.current = controller;
      const setAssistant = (value: string, uiOnly = false) =>
        setMessages((current) => current.map((m) => (m.id === assistantId ? { ...m, content: value, uiOnly } : m)));
      try {
        const body = { messages: history.map(({ role, content: c }) => ({ role, content: c })), lang, context };
        const res = await postJson("/api/ai/chat", body, controller.signal);
        const { truncated } = await readAiStream(res, (partial) => setAssistant(partial), controller.signal);
        if (truncated && !controller.signal.aborted) {
          setMessages((current) => [...current, { id: nextId++, role: "assistant", content: t.ai.truncated, uiOnly: true }]);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof AiStreamFailure) {
          const failure = failureFromStreamCode(error.code);
          const notice = failure.kind === "rate_limited" ? tpl(t.ai.rateLimited, { s: 60 }) : failure.kind === "unavailable" ? t.ai.unavailable : t.ai.interrupted;
          setMessages((current) => [...current, { id: nextId++, role: "assistant", content: notice, uiOnly: true }]);
        } else {
          const failure = failureFromError(error);
          const textForFailure =
            failure.kind === "rate_limited"
              ? tpl(t.ai.rateLimited, { s: failure.retryAfter ?? 60 })
              : failure.kind === "locked"
                ? t.ai.lockedTitle
                : t.ai.failed;
          setAssistant(textForFailure, true);
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        setBusy(false);
        // A reply stopped or failed before its first token would otherwise stay on screen as a permanent "Writing" bubble.
        setMessages((current) => current.filter((m) => m.id !== assistantId || m.content !== ""));
      }
    },
    [busy, messages, lang, context, t],
  );

  // A question typed as "?question" in the command bar: send it once the drawer is open and AI is usable.
  useEffect(() => {
    if (!chatOpen || !chatSeed || aiState !== "available") return;
    const seed = chatSeed;
    const id = window.setTimeout(() => {
      clearChatSeed();
      void send(seed.text);
    }, 0);
    return () => window.clearTimeout(id);
  }, [chatOpen, chatSeed, aiState, clearChatSeed, send]);

  const stop = () => {
    controllerRef.current?.abort();
    setBusy(false);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      void send(input);
    }
  };

  const available = aiState === "available";

  return (
    <Drawer
      open={chatOpen}
      onClose={closeChat}
      title={t.ai.chat.title}
      footer={
        available ? (
          <form onSubmit={onSubmit} className="space-y-2 p-3">
            <div className="flex items-center justify-between text-xs text-fg-3">
              <span className="num truncate">{tpl(t.ai.chat.context, { ctx: contextLabel(context, t, lang) })}</span>
              <Button size="sm" variant="ghost" onClick={() => setMessages([])} disabled={busy || messages.length === 0}>
                <Eraser aria-hidden className="size-3.5" strokeWidth={1.75} />
                {t.ai.chat.clear}
              </Button>
            </div>
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
                className="min-h-[2.75rem] flex-1 resize-none rounded-xs border border-input-border bg-input-bg px-2.5 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
              />
              {busy ? (
                <IconButton label={t.ai.stop} icon={<Square className="size-3.5" strokeWidth={2} />} onClick={stop} />
              ) : (
                <IconButton label={t.ai.chat.send} icon={<SendHorizontal className="size-4" strokeWidth={1.75} />} type="submit" disabled={!input.trim()} />
              )}
            </div>
          </form>
        ) : null
      }
    >
      {available ? (
        <div ref={logRef} role="log" aria-live="polite" aria-busy={busy} className="space-y-4 p-3">
          {messages.length === 0 ? <p className="text-sm text-fg-3">{t.ai.chat.welcome}</p> : null}
          {messages.map((message) => (
            <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              {message.role === "user" ? (
                <div className="max-w-[85%] rounded-xs bg-hover px-3 py-2 text-sm whitespace-pre-wrap text-fg">{message.content}</div>
              ) : message.uiOnly ? (
                <p role="alert" className="text-sm text-warn">
                  {message.content}
                </p>
              ) : (
                <div className="w-full">{message.content ? <Markdown text={message.content} /> : <span className="text-sm text-fg-3">{t.ai.generating}</span>}</div>
              )}
            </div>
          ))}
          {messages.some((m) => m.role === "assistant" && !m.uiOnly && m.content) ? <p className="text-xs text-fg-3">{t.ai.disclaimer}</p> : null}
        </div>
      ) : (
        <AiGate />
      )}
    </Drawer>
  );
}
