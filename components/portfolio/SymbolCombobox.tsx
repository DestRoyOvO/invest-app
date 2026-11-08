"use client";

import { forwardRef, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";

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

interface SymbolComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> {
  value: string;
  onValueChange: (value: string) => void;
  /** A suggestion was chosen (click, or Enter on the highlighted option). */
  onPick: (symbol: string) => void;
  /** Classes for the wrapper (width); the input fills it. */
  className?: string;
  inputClassName?: string;
  /** Render the suggestions in the flow below the input (inside drawers and sheets) instead of floating over the page. */
  inline?: boolean;
}

/**
 * Ticker input with suggestions: Yahoo search for Latin text, and the local Chinese name table for Chinese input (Yahoo
 * cannot search Chinese). A combobox with a listbox: arrows move, Enter picks the highlighted option (otherwise the
 * surrounding form submits the typed text), Escape closes the list. Inside a Field it is labelled automatically.
 */
export const SymbolCombobox = forwardRef<HTMLInputElement, SymbolComboboxProps>(function SymbolCombobox(
  { value, onValueChange, onPick, className, inputClassName, inline = false, onKeyDown, onFocus, onBlur, ...props },
  ref,
) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  // Closing on blur waits a moment (so a click on an option lands); focus coming back cancels it.
  const blurTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(blurTimer.current), []);
  const keepOpen = () => {
    window.clearTimeout(blurTimer.current);
    setFocused(true);
  };
  const [active, setActive] = useState(-1);
  const typed = value.trim();
  const query = useDebounced(typed, 200);
  const { data } = useSymbolSearch(query);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!focused || !typed) return [];
    if (hasCjk(typed)) return searchChineseNames(typed, 6).map((m) => ({ symbol: m.symbol, name: m.name, exchange: null }));
    // Results of an older query are never shown for the new text.
    if (query !== typed) return [];
    return (data?.results ?? []).slice(0, 6).map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange }));
  }, [focused, typed, query, data]);
  const open = suggestions.length > 0;
  const activeIndex = active < suggestions.length ? active : -1;

  const pick = (symbol: string) => {
    setActive(-1);
    onPick(symbol);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing || !open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      pick(suggestions[activeIndex].symbol);
    } else if (event.key === "Escape") {
      // Close the list only; a surrounding drawer closes on the next Escape.
      event.preventDefault();
      event.stopPropagation();
      setFocused(false);
      setActive(-1);
    }
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      <Input
        ref={ref}
        {...props}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setActive(-1);
          keepOpen();
        }}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          keepOpen();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          window.clearTimeout(blurTimer.current);
          blurTimer.current = window.setTimeout(() => setFocused(false), 120);
          onBlur?.(event);
        }}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        className={cn("mono uppercase placeholder:font-sans placeholder:normal-case", inputClassName)}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className={cn("mt-1 rounded-xs border border-line-2 bg-panel py-1", inline ? "relative" : "absolute top-full right-0 left-0 z-30 shadow-xl")}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.symbol}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(s.symbol);
              }}
              className={cn("flex cursor-pointer items-center gap-3 px-2.5 py-1.5 text-sm max-sm:min-h-10", i === activeIndex ? "bg-hover text-fg" : "text-fg-2 hover:bg-hover")}
            >
              <span className="mono w-20 shrink-0 font-medium text-fg">{s.symbol}</span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {s.exchange ? <span className="mono shrink-0 text-xs text-fg-3">{s.exchange}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
