"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div id={id} className="label">
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-2 gap-px rounded-xs bg-line p-px">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 text-xs transition-colors",
              // Opaque background: a translucent accent over the hairline color fails contrast in the light theme.
              value === option.value ? "bg-panel-2 font-medium text-accent shadow-[inset_0_-2px_0_var(--accent)]" : "bg-panel text-fg-2 hover:bg-hover",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Language, theme and up/down color convention. */
export function SettingsMenu() {
  const { t, lang, theme, updown, setLang, setTheme, setUpdown } = usePrefs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        label={t.nav.settings}
        icon={<SlidersHorizontal className="size-4" strokeWidth={1.75} />}
        aria-expanded={open}
        aria-controls={panelId}
        active={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t.settings.title}
          className="absolute top-full right-0 z-50 mt-2 w-64 space-y-3 rounded-xs border border-line-2 bg-panel p-3 shadow-2xl"
        >
          <Segmented
            label={t.settings.language}
            value={lang}
            onChange={setLang}
            options={[
              { value: "en", label: "English" },
              { value: "zh", label: "中文" },
            ]}
          />
          <Segmented
            label={t.settings.theme}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: t.settings.dark },
              { value: "light", label: t.settings.light },
            ]}
          />
          <Segmented
            label={t.settings.colors}
            value={updown}
            onChange={setUpdown}
            options={[
              { value: "intl", label: t.settings.greenUp },
              { value: "cn", label: t.settings.redUp },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
