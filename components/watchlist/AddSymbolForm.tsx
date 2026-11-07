"use client";

import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SymbolCombobox } from "@/components/portfolio/SymbolCombobox";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import type { AddResult } from "@/hooks/useWatchlist";
import { tpl } from "@/lib/format";
import { MAX_WATCHLIST } from "@/lib/universe";

/** Ticker input with search suggestions (Yahoo, plus Chinese company names matched locally). */
export function AddSymbolForm({ onAdd, inputId = "watchlist-add" }: { onAdd: (symbol: string) => AddResult; inputId?: string }) {
  const { t } = usePrefs();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = (symbol: string) => {
    const result = onAdd(symbol);
    if (result === "added" || result === "exists") {
      setValue("");
      setMessage(null);
    } else {
      setMessage(result === "full" ? tpl(t.watchlist.full, { n: MAX_WATCHLIST }) : t.watchlist.invalid);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) submit(value);
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
            setValue(next);
            setMessage(null);
          }}
          onPick={submit}
          placeholder={t.watchlist.addPlaceholder}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${inputId}-error` : undefined}
          inputClassName="max-sm:h-10"
        />
        {message ? (
          <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-danger">
            {message}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="primary" disabled={!value.trim()} className="max-sm:h-10">
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        {t.common.add}
      </Button>
    </form>
  );
}
