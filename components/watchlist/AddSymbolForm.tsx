"use client";

import { Loader2, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { SymbolCombobox } from "@/components/portfolio/SymbolCombobox";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { watchlistActions, type AddResult, type TypedAddResult } from "@/hooks/useWatchlist";
import { tpl } from "@/lib/format";
import { normalizeSymbol } from "@/lib/symbols";
import { MAX_WATCHLIST } from "@/lib/universe";

interface AddSymbolFormProps {
  /** A suggestion was picked: a search result, added as it is. */
  onAdd: (symbol: string) => AddResult;
  /**
   * Text was submitted: added once the data source knows it (watchlistActions.addTyped), with the result at once when
   * the text settles it and as a promise while the data source is asked.
   */
  onAddTyped?: (input: string) => AddResult | Promise<TypedAddResult>;
  inputId?: string;
}

/**
 * Ticker input with search suggestions (Yahoo, plus Chinese company names matched locally). A picked suggestion is
 * added at once; typed text is looked up first, with the button showing the check, and a symbol the data source does
 * not know is refused under the field.
 */
export function AddSymbolForm({ onAdd, onAddTyped = watchlistActions.addTyped, inputId = "watchlist-add" }: AddSymbolFormProps) {
  const { t } = usePrefs();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  /** The typed symbol being looked up. */
  const [checking, setChecking] = useState<string | null>(null);
  // The field's text as it is now, for a lookup that answers after the reader has typed on.
  const current = useRef("");

  const edit = (next: string) => {
    current.current = next;
    setValue(next);
  };

  const show = (result: TypedAddResult, symbol: string | null) => {
    if (result === "added" || result === "exists") {
      edit("");
      setMessage(null);
    } else if (result === "unknown") {
      setMessage(tpl(t.watchlist.unknown, { symbol: symbol ?? "" }));
    } else {
      setMessage(result === "full" ? tpl(t.watchlist.full, { n: MAX_WATCHLIST }) : t.watchlist.invalid);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text || checking) return;
    const symbol = normalizeSymbol(text);
    const outcome = onAddTyped(text);
    if (typeof outcome === "string") {
      show(outcome, symbol);
      return;
    }
    setChecking(symbol);
    void outcome.then((result) => {
      setChecking(null);
      // Typed on while the data source answered: the symbol is added (or refused) all the same, and the new text stays.
      if (normalizeSymbol(current.current) === symbol) show(result, symbol);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="sr-only">
          {t.watchlist.addPlaceholder}
        </label>
        <SymbolCombobox
          id={inputId}
          value={value}
          onValueChange={(next) => {
            edit(next);
            setMessage(null);
          }}
          onPick={(symbol) => show(onAdd(symbol), symbol)}
          placeholder={t.watchlist.addPlaceholder}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${inputId}-error` : undefined}
        />
        {message ? (
          <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-danger">
            {message}
          </p>
        ) : null}
      </div>
      {/* While the check runs the button stays focusable (aria-disabled, not disabled), so focus does not jump away. */}
      <Button type="submit" variant="primary" disabled={!value.trim()} aria-disabled={checking ? true : undefined}>
        {checking ? (
          <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
        ) : (
          <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        )}
        {checking ? t.watchlist.checking : t.common.add}
      </Button>
    </form>
  );
}
