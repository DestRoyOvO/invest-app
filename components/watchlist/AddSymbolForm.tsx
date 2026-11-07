"use client";

import { Plus } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { useSymbolSearch } from "@/hooks/useApi";
import { useDebounced } from "@/hooks/useLocalValue";
import type { AddResult } from "@/hooks/useWatchlist";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { MAX_WATCHLIST } from "@/lib/universe";

/** Ticker input with search suggestions. */
export function AddSymbolForm({ onAdd }: { onAdd: (symbol: string) => AddResult }) {
  const { t } = usePrefs();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const query = useDebounced(value.trim(), 200);
  const { data } = useSymbolSearch(query);
  const suggestions = focused && value.trim() ? (data?.results ?? []).slice(0, 6) : [];

  const submit = (symbol: string) => {
    const result = onAdd(symbol);
    if (result === "added" || result === "exists") {
      setValue("");
      setMessage(null);
      setActive(-1);
    } else {
      setMessage(result === "full" ? tpl(t.watchlist.full, { n: MAX_WATCHLIST }) : t.watchlist.invalid);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const pick = active >= 0 ? suggestions[active]?.symbol : undefined;
    submit(pick ?? value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Escape") {
      setActive(-1);
      setFocused(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="relative flex items-start gap-2 px-3 py-2.5">
      <div className="relative min-w-0 flex-1">
        <label htmlFor="watchlist-add" className="sr-only">
          {t.watchlist.addPlaceholder}
        </label>
        <input
          id="watchlist-add"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage(null);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder={t.watchlist.addPlaceholder}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="mono h-8 w-full rounded-xs border border-input-border bg-input-bg px-2.5 text-sm text-fg uppercase placeholder:normal-case placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        {suggestions.length > 0 ? (
          <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1 rounded-xs border border-line-2 bg-panel py-1 shadow-xl">
            {suggestions.map((s, i) => (
              <li
                key={s.symbol}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  submit(s.symbol);
                }}
                className={cn("flex cursor-pointer items-center gap-3 px-2.5 py-1.5 text-sm", i === active ? "bg-hover text-fg" : "text-fg-2")}
              >
                <span className="mono w-20 shrink-0 font-medium text-fg">{s.symbol}</span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="mono shrink-0 text-xs text-fg-3">{s.exchange}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {message ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {message}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="primary" disabled={!value.trim()}>
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        {t.common.add}
      </Button>
    </form>
  );
}
