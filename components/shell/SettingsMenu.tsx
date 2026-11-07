"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { DataMenuSection } from "@/components/data/DataMenuSection";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { IconButton } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";

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
            size="sm"
            label={t.settings.language}
            value={lang}
            onChange={setLang}
            options={[
              { value: "en", label: "English" },
              { value: "zh", label: "中文" },
            ]}
          />
          <Segmented
            size="sm"
            label={t.settings.theme}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: t.settings.dark },
              { value: "light", label: t.settings.light },
            ]}
          />
          <Segmented
            size="sm"
            label={t.settings.colors}
            value={updown}
            onChange={setUpdown}
            options={[
              { value: "intl", label: t.settings.greenUp },
              { value: "cn", label: t.settings.redUp },
            ]}
          />
          <DataMenuSection onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
