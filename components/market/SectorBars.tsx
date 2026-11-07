"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { getSector } from "@/lib/universe";
import type { SectorSnapshot } from "@/types/api";

/** A bar growing left (down) or right (up) from a center line, scaled to the largest move in the list. Decorative. */
export function DivergingBar({ change, maxAbs }: { change: number | null; maxAbs: number }) {
  const value = change ?? 0;
  const width = `${(Math.min(Math.abs(value), maxAbs) / maxAbs) * 50}%`;
  return (
    <span aria-hidden className="relative h-2.5">
      <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
      {value !== 0 ? (
        <span className={value > 0 ? "absolute inset-y-0 left-1/2 bg-up/70" : "absolute inset-y-0 right-1/2 bg-down/70"} style={{ width }} />
      ) : null}
    </span>
  );
}

/**
 * Sector performance as a diverging bar chart (cap-weighted change), sorted best to worst. The labels switch to the
 * short names when the panel is narrow (a container query, so the right-hand column at xl gets them too).
 */
export function SectorBars({ sectors }: { sectors: SectorSnapshot[] }) {
  const { lang } = usePrefs();
  const rows = [...sectors].sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
  const maxAbs = Math.max(1, ...rows.map((s) => Math.abs(s.changePercent ?? 0)));

  return (
    <ul className="@container py-1">
      {rows.map((sector) => {
        const def = getSector(sector.key);
        const label = def?.label[lang] ?? sector.key;
        return (
          <li key={sector.key}>
            <Link
              href={`/sector/${sector.key}`}
              className="grid h-7 grid-cols-[minmax(0,1fr)_minmax(5rem,40%)_4.25rem] items-center gap-2 px-3 text-xs transition-colors hover:bg-hover max-sm:h-10"
            >
              <span className="truncate text-fg-2" title={label}>
                <span className="@max-[26rem]:hidden">{label}</span>
                <span className="hidden @max-[26rem]:inline">{def?.short[lang] ?? label}</span>
              </span>
              <DivergingBar change={sector.changePercent} maxAbs={maxAbs} />
              <Delta value={sector.changePercent} className="text-right" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
