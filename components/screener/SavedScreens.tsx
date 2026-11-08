"use client";

import { X } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useSavedScreens } from "@/hooks/useScreens";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";
import { cleanScreenName, countActiveFilters, MAX_SAVED_SCREENS, MAX_SCREEN_NAME, screenFromParams, screenToQuery, type Screen } from "@/lib/screens";

import { focusFirst } from "./focus";

interface SavedScreensProps {
  screen: Screen;
  onOpen: (screen: Screen) => void;
  /** Inside the filter sheet on phones the list renders without its own panel. */
  bare?: boolean;
  className?: string;
}

/** Named screens kept in this browser (up to 30): open one, delete one with undo, or save the current screen. */
export function SavedScreens({ screen, onOpen, bare = false, className }: SavedScreensProps) {
  const { t } = usePrefs();
  const toast = useToast();
  const { screens, save, remove, restore } = useSavedScreens();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentQuery = screenToQuery(screen);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const clean = cleanScreenName(name);
    const result = save(clean, screen);
    if (result === "invalid") return setError(t.screener.saved.invalid);
    if (result === "full") return setError(tpl(t.screener.saved.full, { n: MAX_SAVED_SCREENS }));
    setError(null);
    setName("");
    toast.show({ message: tpl(result === "updated" ? t.screener.saved.updated : t.screener.saved.saved, { name: clean }) });
  };

  const onRemove = (id: string) => {
    const removed = flushSync(() => remove(id));
    if (!removed) return;
    // The row and its delete button are gone: focus the screen that took its place, the one above, or the name field.
    const left = listRef.current?.querySelectorAll<HTMLElement>("button[data-saved-open]");
    focusFirst(left?.[removed.index], left?.[removed.index - 1], inputRef.current);
    toast.show({
      message: tpl(t.screener.saved.removed, { name: removed.entry.name }),
      action: { label: t.screener.undo, onAction: () => restore(removed.entry, removed.index) },
    });
  };

  const body = (
    <div className="space-y-3 px-3 py-3">
      {screens.length === 0 ? (
        <p className="text-sm text-fg-2">{t.screener.saved.empty}</p>
      ) : (
        <ul ref={listRef} className="-mx-3">
          {screens.map((entry) => {
            const parsed = screenFromParams(new URLSearchParams(entry.query));
            const count = countActiveFilters(parsed.filters);
            const kind = t.screener.universeNames[parsed.universe];
            const current = entry.query === currentQuery;
            return (
              <li key={entry.id} className={cn("group/saved relative flex items-center gap-1 pr-2 transition-colors hover:bg-hover", current && "bg-panel-2")}>
                {current ? <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 bg-accent" /> : null}
                <button
                  type="button"
                  data-saved-open
                  onClick={() => onOpen(parsed)}
                  title={tpl(t.screener.saved.open, { name: entry.name })}
                  aria-current={current ? "true" : undefined}
                  className="flex min-h-9 min-w-0 flex-1 flex-col justify-center py-1 pl-3 text-left max-sm:min-h-11 focus-visible:outline-offset-[-2px]"
                >
                  <span className="truncate text-sm text-fg">{entry.name}</span>
                  <span className="truncate text-micro text-fg-3">
                    {tpl(count === 0 ? t.screener.saved.metaNone : count === 1 ? t.screener.saved.metaOne : t.screener.saved.meta, { kind, n: count })}
                    {current ? ` · ${t.screener.saved.current}` : ""}
                  </span>
                </button>
                <IconButton size="sm" label={tpl(t.screener.saved.remove, { name: entry.name })} icon={<X className="size-3.5" strokeWidth={1.75} />} onClick={() => onRemove(entry.id)} />
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={onSubmit} className="space-y-1.5" noValidate>
        <label htmlFor={inputId} className="block text-xs font-medium text-fg-2">
          {t.screener.saved.name}
        </label>
        <div className="flex gap-1.5">
          <Input
            ref={inputRef}
            id={inputId}
            size="sm"
            value={name}
            maxLength={MAX_SCREEN_NAME}
            placeholder={t.screener.saved.placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            className="max-sm:text-sm"
          />
          <Button type="submit" size="sm">
            {t.screener.saved.save}
          </Button>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <p className="text-micro text-fg-3">{t.screener.saved.storedLocally}</p>
      </form>
    </div>
  );

  if (bare) {
    return (
      <section aria-label={t.screener.saved.title}>
        <h3 className="col-head px-3 pt-3">{t.screener.saved.title}</h3>
        {body}
      </section>
    );
  }
  return (
    <Panel title={t.screener.saved.title} className={className} actions={<PanelMeta>{tpl(t.screener.saved.count, { n: screens.length, max: MAX_SAVED_SCREENS })}</PanelMeta>}>
      {body}
    </Panel>
  );
}
