"use client";

import {
  Bell,
  CornerDownLeft,
  Languages,
  Layers,
  MessageSquareText,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Rows3,
  Star,
  StarOff,
  Sun,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { Kbd } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useSymbolSearch } from "@/hooks/useApi";
import { useHoldings } from "@/hooks/useHoldings";
import { useLastSymbol } from "@/hooks/useLastSymbol";
import { useDebounced } from "@/hooks/useLocalValue";
import { useLastSector, useRecents } from "@/hooks/useRecents";
import { useWatchlist } from "@/hooks/useWatchlist";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { shortcutKeys } from "@/lib/functions";
import type { Messages } from "@/lib/i18n/messages";
import { chineseNameOf } from "@/lib/names-zh";
import { MAX_WATCHLIST, SECTORS } from "@/lib/universe";
import type { Lang } from "@/types/api";

import { CodeChip } from "./CodeChip";
import { buildPalette, shouldSearch, type PaletteItem, type SettingChoice } from "./palette";

const iconClass = "size-4 shrink-0 text-fg-3";

const ACTION_ICONS: Record<"open" | "watch" | "unwatch" | "position" | "alert" | "why", LucideIcon> = {
  open: TrendingUp,
  watch: Star,
  unwatch: StarOff,
  position: Pencil,
  alert: Bell,
  why: MessageSquareText,
};

function settingIcon(choice: SettingChoice): LucideIcon {
  if (choice.kind === "lang") return Languages;
  if (choice.kind === "theme") return choice.value === "dark" ? Moon : choice.value === "light" ? Sun : Monitor;
  if (choice.kind === "updown") return Palette;
  return Rows3;
}

function settingLabel(t: Messages, choice: SettingChoice): string {
  const s = t.settings;
  if (choice.kind === "lang") return t.command.switchLang;
  if (choice.kind === "theme") return tpl(t.command.themeTo, { name: choice.value === "dark" ? s.dark : choice.value === "light" ? s.light : s.system });
  if (choice.kind === "updown") return tpl(t.command.colorsTo, { name: choice.value === "intl" ? s.greenUp : choice.value === "cn" ? s.redUp : s.colorBlind });
  return tpl(t.command.densityTo, { name: choice.value === "compact" ? s.compact : s.comfortable });
}

/** One line of the list: icon or code chip, the main text, and quiet detail on the right. */
interface Row {
  lead: ReactNode;
  main: ReactNode;
  detail?: ReactNode;
}

function rowFor(item: PaletteItem, t: Messages, lang: Lang, holdings: Readonly<Record<string, unknown>>): Row {
  const symbolText = (symbol: string, name: string | null) => {
    const zh = lang === "zh" ? chineseNameOf(symbol) : undefined;
    const shown = [...new Set([zh, name].filter(Boolean))].join(" · ");
    return (
      <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className="mono shrink-0 font-medium text-fg">{symbol}</span>
        {shown ? <span className="truncate text-fg-2">{shown}</span> : null}
      </span>
    );
  };

  switch (item.kind) {
    case "ask":
      return { lead: <MessageSquareText aria-hidden className={iconClass} strokeWidth={1.75} />, main: tpl(t.command.ask, { q: item.question }) };
    case "function": {
      const { fn, symbol, compare, usesLastSymbol } = item.match;
      const keys = shortcutKeys(fn.shortcut);
      return {
        lead: <CodeChip code={fn.code} />,
        main: (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate">{t.help.functions[fn.labelKey].label}</span>
            {symbol ? <span className="mono shrink-0 font-medium text-fg">{symbol}</span> : null}
            {compare.length > 0 ? <span className="mono truncate text-fg-2">{tpl(t.command.compareWith, { symbols: compare.join(" ") })}</span> : null}
            {symbol && usesLastSymbol ? <span className="hidden shrink-0 text-xs text-fg-3 sm:inline">{t.command.lastViewed}</span> : null}
          </span>
        ),
        detail: keys.length > 0 ? <span className="label hidden sm:inline">{keys.join(" ")}</span> : null,
      };
    }
    case "action": {
      const Icon = ACTION_ICONS[item.action];
      const symbol = item.symbol;
      const text =
        item.action === "open"
          ? null
          : item.action === "watch"
            ? tpl(t.command.addToWatchlist, { symbol })
            : item.action === "unwatch"
              ? tpl(t.command.removeFromWatchlist, { symbol })
              : item.action === "position"
                ? tpl(symbol in holdings ? t.command.editPosition : t.command.addPosition, { symbol })
                : item.action === "alert"
                  ? tpl(t.command.setAlert, { symbol })
                  : tpl(t.command.whyMoving, { symbol });
      return {
        lead: <Icon aria-hidden className={iconClass} strokeWidth={1.75} />,
        main:
          text ?? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
              <span className="shrink-0">{t.command.open}</span>
              {symbolText(symbol, item.name)}
            </span>
          ),
      };
    }
    case "symbol":
      return {
        lead: <TrendingUp aria-hidden className={iconClass} strokeWidth={1.75} />,
        main: symbolText(item.symbol, item.name),
        detail: item.detail ? <span className="mono hidden text-xs text-fg-3 sm:inline">{item.detail}</span> : null,
      };
    case "sector": {
      const sector = SECTORS.find((s) => s.key === item.key);
      return {
        lead: <Layers aria-hidden className={iconClass} strokeWidth={1.75} />,
        main: tpl(t.command.goSector, { name: sector ? sector.label[lang] : item.key }),
        detail: sector ? <span className="mono hidden text-xs text-fg-3 sm:inline">{sector.etf}</span> : null,
      };
    }
    case "setting": {
      const Icon = settingIcon(item.choice);
      return { lead: <Icon aria-hidden className={iconClass} strokeWidth={1.75} />, main: settingLabel(t, item.choice) };
    }
  }
}

/** The command bar dialog. Mounted only while open, so every opening starts fresh (or with the given text). */
function PaletteDialog({ initialQuery }: { initialQuery: string }) {
  const { closeCommand, openChat, openPositionEditor, openAlertEditor } = useUi();
  const { t, lang, setLang, setTheme, setUpdown, setDensity } = usePrefs();
  const router = useRouter();
  const toast = useToast();
  const watchlist = useWatchlist();
  const { holdings } = useHoldings();
  const recents = useRecents();
  const lastSymbol = useLastSymbol();
  const lastSector = useLastSector();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 180);
  const searchTerm = shouldSearch(debounced) ? debounced : "";
  const { data: search, isLoading } = useSymbolSearch(searchTerm);
  const results = searchTerm && searchTerm === trimmed ? (search?.results ?? null) : null;

  const close = () => closeCommand();
  const closeFromDocument = useEffectEvent(() => closeCommand());

  // Modal behaviour: focus starts in the input and cannot leave the dialog, Escape closes it from anywhere, and focus
  // returns to where it was when the dialog closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const input = inputRef.current;
    input?.focus();
    const end = input?.value.length ?? 0;
    input?.setSelectionRange(end, end);
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
  }, []);

  const items = useMemo(
    () => buildPalette({ query, lastSymbol, lastSector, recents, watchlist: watchlist.symbols, results }),
    [query, lastSymbol, lastSector, recents, watchlist.symbols, results],
  );
  const safeIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));

  // Keep the selected option in view while moving with the keyboard.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  const go = (href: string) => {
    router.push(href);
    close();
  };

  const watch = (symbol: string) => {
    const result = watchlist.add(symbol);
    if (result === "full") toast.show({ message: tpl(t.watchlist.full, { n: MAX_WATCHLIST }) });
    else if (result === "added") toast.show({ message: tpl(t.command.added, { symbol }), action: { label: t.command.undo, onAction: () => watchlist.remove(symbol) } });
  };
  const unwatch = (symbol: string) => {
    watchlist.remove(symbol);
    toast.show({ message: tpl(t.command.removed, { symbol }), action: { label: t.command.undo, onAction: () => watchlist.add(symbol) } });
  };

  const applySetting = (choice: SettingChoice) => {
    if (choice.kind === "lang") setLang(lang === "en" ? "zh" : "en");
    else if (choice.kind === "theme") setTheme(choice.value);
    else if (choice.kind === "updown") setUpdown(choice.value);
    else setDensity(choice.value);
  };

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    switch (item.kind) {
      case "ask":
        close();
        openChat(item.question);
        return;
      case "function":
        go(item.match.href);
        return;
      case "symbol":
        go(stockPath(item.symbol));
        return;
      case "sector":
        go(`/sector/${item.key}`);
        return;
      case "setting":
        applySetting(item.choice);
        close();
        return;
      case "action": {
        const symbol = item.symbol;
        if (item.action === "open") return go(stockPath(symbol));
        close();
        if (item.action === "watch") watch(symbol);
        else if (item.action === "unwatch") unwatch(symbol);
        else if (item.action === "position") openPositionEditor(symbol);
        else if (item.action === "alert") openAlertEditor(symbol);
        else openChat({ text: tpl(t.command.whyMovingQuestion, { symbol }), intent: { kind: "move", symbol } });
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const count = items.length;
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      // The input is the only focusable element: Tab moves the selection instead of leaving the dialog.
      event.preventDefault();
      setActiveIndex(count ? (safeIndex + 1) % count : 0);
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      setActiveIndex(count ? (safeIndex - 1 + count) % count : 0);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setActiveIndex(Math.min(count - 1, safeIndex + 8));
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setActiveIndex(Math.max(0, safeIndex - 8));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(items[safeIndex]);
    }
  };

  const searching = Boolean(searchTerm) && isLoading;
  const onlyUnconfirmed = items.length === 1 && items[0].kind === "symbol" && items[0].name === null && results !== null && results.length === 0;
  const showEmpty = trimmed.length > 0 && !searching && debounced === trimmed && (items.length === 0 || onlyUnconfirmed);

  // Consecutive items of one section form a labelled group.
  const groups: Array<{ section: PaletteItem["section"]; entries: Array<{ item: PaletteItem; index: number }> }> = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.entries.push({ item, index });
    else groups.push({ section: item.section, entries: [{ item, index }] });
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[10vh]">
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.command.title}
        className="relative flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-xs border border-line-2 bg-panel shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
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
            aria-label={t.command.title}
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items[safeIndex] ? `${listId}-${safeIndex}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            className="mono h-full min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-3 focus:outline-none max-sm:text-base"
          />
          {searching ? <span className="shrink-0 text-xs text-fg-3">{t.command.searching}</span> : null}
        </div>

        <div role="status" className={cn("shrink-0 text-sm text-fg-2", showEmpty ? "border-b border-line px-3 py-3" : "sr-only")}>
          {showEmpty ? t.command.empty : items.length > 0 && trimmed ? tpl(t.command.results, { n: items.length }) : ""}
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label={t.command.title} className="min-h-0 flex-1 overflow-y-auto py-1">
          {groups.map(({ section, entries }) => (
            <div key={`${section}-${entries[0].index}`} role="group" aria-label={t.command.sections[section]}>
              <div aria-hidden className="label px-3 pt-2 pb-1">
                {t.command.sections[section]}
              </div>
              {entries.map(({ item, index }) => {
                const selected = index === safeIndex;
                const row = rowFor(item, t, lang, holdings);
                return (
                  <div
                    key={item.id}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => {
                      if (!selected) setActiveIndex(index);
                    }}
                    onClick={() => run(item)}
                    className={cn("flex h-9 cursor-pointer items-center gap-3 px-3 text-sm max-sm:h-11", selected ? "bg-hover text-fg" : "text-fg-2")}
                  >
                    {row.lead}
                    {typeof row.main === "string" ? <span className="min-w-0 flex-1 truncate">{row.main}</span> : row.main}
                    {row.detail}
                    <CornerDownLeft aria-hidden className={cn("size-3.5 shrink-0 text-fg-3", !selected && "invisible")} strokeWidth={1.75} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div aria-hidden className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 text-xs text-fg-3 max-sm:hidden">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t.command.hints.move}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd>
            {t.command.hints.run}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd>
            {t.command.hints.close}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>?</Kbd>
            {t.command.hints.ask}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The command bar: functions, symbols, recent symbols, the watchlist and symbol actions. Opened with / or Ctrl+K. */
export function CommandPalette() {
  const { commandOpen, commandQuery } = useUi();
  return commandOpen ? <PaletteDialog initialQuery={commandQuery} /> : null;
}
