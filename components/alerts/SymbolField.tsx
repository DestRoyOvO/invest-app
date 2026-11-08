"use client";

import { useId, useState, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/Field";
import { useSymbolSearch } from "@/hooks/useApi";
import { useDebounced } from "@/hooks/useLocalValue";
import { cn } from "@/lib/cn";
import { hasCjk, searchChineseNames } from "@/lib/names-zh";

interface Suggestion {
  symbol: string;
  name: string;
  exchange: string | null;
}

interface SymbolFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Ticker input with suggestions: Yahoo search for Latin text, the local Chinese name table for Chinese (Yahoo cannot
 * search Chinese). Arrow keys move through the list, Enter picks, Escape closes only the list. Use inside a Field.
 */
export function SymbolField({ value, onChange, placeholder, autoFocus = false }: SymbolFieldProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = useDebounced(value.trim(), 200);
  const cjk = hasCjk(query);
  const { data } = useSymbolSearch(cjk ? "" : query);
  const suggestions: Suggestion[] = !open || !value.trim()
    ? []
    : cjk
      ? searchChineseNames(query, 6).map((match) => ({ symbol: match.symbol, name: match.name, exchange: null }))
      : (data?.results ?? []).slice(0, 6).map((result) => ({ symbol: result.symbol, name: result.name, exchange: result.exchange }));
  // Hide the list once the field holds exactly the one suggested ticker.
  const visible = suggestions.length === 1 && suggestions[0].symbol === value.trim().toUpperCase() ? [] : suggestions;

  const pick = (symbol: string) => {
    onChange(symbol);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || visible.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % visible.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? visible.length - 1 : index - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      pick(visible[active].symbol);
    } else if (event.key === "Escape") {
      // Close the list, not the drawer around it. React and the drawer both listen on the document (React first),
      // so the drawer is stopped with stopImmediatePropagation.
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        data-autofocus={autoFocus ? true : undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 && visible[active] ? `${listId}-${active}` : undefined}
        className="mono uppercase placeholder:normal-case max-sm:h-10"
      />
      <ul id={listId} role="listbox" className={cn("absolute top-full right-0 left-0 z-20 mt-1 rounded-xs border border-line-2 bg-panel py-1 shadow-xl", visible.length === 0 && "hidden")}>
        {visible.map((suggestion, index) => (
          <li
            key={suggestion.symbol}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(suggestion.symbol);
            }}
            className={cn("flex cursor-pointer items-center gap-3 px-2.5 py-1.5 text-sm max-sm:py-2.5", index === active ? "bg-hover text-fg" : "text-fg-2 hover:bg-hover")}
          >
            <span className="mono w-20 shrink-0 font-medium text-fg">{suggestion.symbol}</span>
            <span className="min-w-0 flex-1 truncate">{suggestion.name}</span>
            {suggestion.exchange ? <span className="mono shrink-0 text-xs text-fg-3">{suggestion.exchange}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
