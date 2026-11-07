"use client";

import { CornerDownLeft, Layers, LayoutGrid, Languages, MessageSquareText, Moon, Star, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { useSymbolSearch } from "@/hooks/useApi";
import { useDebounced } from "@/hooks/useLocalValue";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { normalizeSymbol } from "@/lib/symbols";
import { SECTORS } from "@/lib/universe";

interface CommandItem {
  id: string;
  section: "commands" | "symbols" | "sectors";
  label: string;
  /** Search results show the ticker in mono and the company name in sans. */
  symbol?: string;
  name?: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

const iconClass = "size-4 shrink-0 text-fg-3";

function matches(query: string, aliases: string[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return aliases.some((alias) => alias.toLowerCase().startsWith(q) || (q.length >= 2 && alias.toLowerCase().includes(q)));
}

export function CommandPalette() {
  const { commandOpen, closeCommand, openChat } = useUi();
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 180);
  const searchTerm = debounced.startsWith("?") ? "" : debounced;
  const { data: search, isLoading } = useSymbolSearch(searchTerm);

  const close = () => {
    closeCommand();
    setQuery("");
    setActiveIndex(0);
  };
  const closeFromDocument = useEffectEvent(() => close());

  // Modal behaviour: focus starts in the input and cannot leave the dialog, and Escape closes it from anywhere.
  useEffect(() => {
    if (!commandOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      closeFromDocument();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      previous?.focus?.();
    };
  }, [commandOpen]);

  const go = (href: string) => {
    router.push(href);
    close();
  };

  const items = useMemo<CommandItem[]>(() => {
    const out: CommandItem[] = [];
    if (trimmed.startsWith("?")) {
      const question = trimmed.slice(1).trim();
      if (question) {
        out.push({
          id: "ask",
          section: "commands",
          label: tpl(t.command.ask, { q: question }),
          icon: <MessageSquareText aria-hidden className={iconClass} strokeWidth={1.75} />,
          run: () => {
            openChat(question);
            close();
          },
        });
      }
      return out;
    }

    // Ranking: an exact search match first, then other matches; the raw "Open X" entry leads only while
    // results are loading (so typing a known ticker and pressing Enter stays fast) and trails otherwise.
    const symbol = normalizeSymbol(trimmed);
    const results = searchTerm === trimmed ? (search?.results ?? []) : [];
    const exact = symbol ? results.find((r) => r.symbol === symbol) : undefined;
    const rawItem: CommandItem | null = symbol
      ? {
          id: `open:${symbol}`,
          section: "symbols",
          label: tpl(t.command.openSymbol, { symbol }),
          icon: <TrendingUp aria-hidden className={iconClass} strokeWidth={1.75} />,
          run: () => go(stockPath(symbol)),
        }
      : null;
    const resultItems: CommandItem[] = [...results]
      .sort((a, b) => (a.symbol === symbol ? -1 : b.symbol === symbol ? 1 : 0))
      .map((result) => ({
        id: `sym:${result.symbol}`,
        section: "symbols",
        label: `${result.symbol}  ${result.name}`,
        symbol: result.symbol,
        name: result.name,
        hint: [result.exchange, result.type].filter(Boolean).join(" · "),
        icon: <TrendingUp aria-hidden className={iconClass} strokeWidth={1.75} />,
        run: () => go(stockPath(result.symbol)),
      }));
    if (rawItem && results.length === 0) out.push(rawItem);
    out.push(...resultItems);
    if (rawItem && results.length > 0 && !exact) out.push(rawItem);

    const commands: Array<CommandItem & { aliases: string[] }> = [
      {
        id: "go:market",
        section: "commands",
        label: t.command.goMarket,
        hint: "MKT",
        aliases: ["mkt", "market", "home", "overview", "市场", "总览"],
        icon: <LayoutGrid aria-hidden className={iconClass} strokeWidth={1.75} />,
        run: () => go("/"),
      },
      {
        id: "go:watchlist",
        section: "commands",
        label: t.command.goWatchlist,
        hint: "WL",
        aliases: ["wl", "watchlist", "watch", "自选"],
        icon: <Star aria-hidden className={iconClass} strokeWidth={1.75} />,
        run: () => go("/watchlist"),
      },
      {
        id: "lang",
        section: "commands",
        label: t.command.switchLang,
        hint: "LANG",
        aliases: ["lang", "language", "中文", "english", "语言"],
        icon: <Languages aria-hidden className={iconClass} strokeWidth={1.75} />,
        run: () => {
          setLang(lang === "en" ? "zh" : "en");
          close();
        },
      },
      {
        id: "theme",
        section: "commands",
        label: t.command.toggleTheme,
        hint: "THEME",
        aliases: ["theme", "dark", "light", "主题", "深色", "浅色"],
        icon: <Moon aria-hidden className={iconClass} strokeWidth={1.75} />,
        run: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          close();
        },
      },
    ];
    for (const command of commands) {
      if (matches(trimmed, command.aliases)) out.push(command);
    }

    if (trimmed.length >= 2) {
      for (const sector of SECTORS) {
        const aliases = [sector.key, sector.label.en, sector.label.zh, sector.short.en, sector.short.zh, sector.etf];
        if (matches(trimmed, aliases)) {
          out.push({
            id: `sector:${sector.key}`,
            section: "sectors",
            label: tpl(t.command.goSector, { name: sector.label[lang] }),
            hint: sector.etf,
            icon: <Layers aria-hidden className={iconClass} strokeWidth={1.75} />,
            run: () => go(`/sector/${sector.key}`),
          });
        }
      }
    }
    return out;
    // `go`/`close` are recreated each render but only call stable setters and router methods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, searchTerm, search, t, lang, theme]);

  const safeIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[safeIndex]?.run();
    } else if (event.key === "Tab") {
      // The input is the only focusable element: Tab moves the selection instead of leaving the dialog.
      event.preventDefault();
      setActiveIndex((i) => (items.length ? (i + (event.shiftKey ? items.length - 1 : 1)) % items.length : 0));
    }
  };

  if (!commandOpen) return null;

  let lastSection: CommandItem["section"] | null = null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]">
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={close} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t.command.title} className="relative w-full max-w-xl overflow-hidden rounded-xs border border-line-2 bg-panel shadow-2xl">
        <div className="flex h-12 items-center gap-2 border-b border-line px-3">
          <span aria-hidden className="mono text-accent">
            &gt;
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t.shell.commandPlaceholder}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items[safeIndex] ? `${listId}-${safeIndex}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            className="mono h-full min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-3 focus:outline-none"
          />
          {isLoading && searchTerm ? <span className="text-xs text-fg-3">{t.command.searching}</span> : null}
        </div>
        <ul id={listId} role="listbox" aria-label={t.command.title} className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((item, index) => {
            const header = item.section !== lastSection ? t.command.sections[item.section] : null;
            lastSection = item.section;
            const selected = index === safeIndex;
            return (
              <li key={item.id} role="presentation">
                {header ? <div className="label px-3 pt-2 pb-1">{header}</div> : null}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={item.run}
                  className={cn("flex h-9 cursor-pointer items-center gap-3 px-3 text-sm", selected ? "bg-hover text-fg" : "text-fg-2")}
                >
                  {item.icon}
                  {item.symbol ? (
                    <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                      <span className="mono shrink-0 font-medium text-fg">{item.symbol}</span>
                      <span className="truncate text-fg-2">{item.name}</span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  )}
                  {item.hint ? <span className="mono hidden shrink-0 text-xs text-fg-3 sm:inline">{item.hint}</span> : null}
                  {selected ? <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mono border-t border-line px-3 py-1.5 text-xs text-fg-3">{t.command.hint}</div>
      </div>
    </div>
  );
}
