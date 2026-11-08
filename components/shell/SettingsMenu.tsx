"use client";

import { SlidersHorizontal } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { DataMenuSection } from "@/components/data/DataMenuSection";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { IconButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Segmented } from "@/components/ui/Segmented";

/**
 * Language, theme, price colors and density, plus the data section (backup and import). The top bar stays mounted
 * across pages, so the menu remembers the page it was opened on and closes when the page changes.
 */
export function SettingsMenu() {
  const { t, lang, theme, updown, density, setLang, setTheme, setUpdown, setDensity } = usePrefs();
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  // Another page (a link, Back or Forward): forget the menu, so coming back does not reopen it.
  if (openOn !== null && openOn !== pathname) setOpenOn(null);
  const open = openOn === pathname;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const s = t.settings;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenOn(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
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
        onClick={() => setOpenOn(open ? null : pathname)}
      />
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={s.title}
          className="absolute top-full right-0 z-50 mt-2 max-h-[calc(100dvh-4rem)] w-72 space-y-3 overflow-y-auto rounded-xs border border-line-2 bg-panel p-3 shadow-2xl"
        >
          <Segmented
            size="sm"
            label={s.language}
            value={lang}
            onChange={setLang}
            options={[
              { value: "en", label: "English" },
              { value: "zh", label: "中文" },
            ]}
          />
          <Segmented
            size="sm"
            label={s.theme}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: s.dark },
              { value: "light", label: s.light },
              { value: "system", label: s.system },
            ]}
          />
          <div className="space-y-1.5">
            <Segmented
              size="sm"
              label={s.colors}
              value={updown}
              onChange={setUpdown}
              options={[
                { value: "intl", label: s.greenUp },
                { value: "cn", label: s.redUp },
                { value: "cb", label: s.colorBlind },
              ]}
            />
            <div className="flex items-center gap-2 text-xs text-fg-3">
              <span>{updown === "cb" ? s.colorBlindHint : s.preview}</span>
              <Delta value={1.24} className="ml-auto" />
              <Delta value={-0.86} />
            </div>
          </div>
          <Segmented
            size="sm"
            label={s.density}
            value={density}
            onChange={setDensity}
            options={[
              { value: "comfortable", label: s.comfortable },
              { value: "compact", label: s.compact },
            ]}
          />
          <DataMenuSection onNavigate={() => setOpenOn(null)} />
        </div>
      ) : null}
    </div>
  );
}
