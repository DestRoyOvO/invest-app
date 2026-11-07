"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { getSector } from "@/lib/universe";
import type { SectorSnapshot } from "@/types/api";

/** Sector performance as a diverging bar chart (cap-weighted change), sorted best to worst. */
export function SectorBars({ sectors }: { sectors: SectorSnapshot[] }) {
  const { lang } = usePrefs();
  const rows = [...sectors].sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
  const maxAbs = Math.max(1, ...rows.map((s) => Math.abs(s.changePercent ?? 0)));

  return (
    <ul className="py-1">
      {rows.map((sector) => {
        const def = getSector(sector.key);
        const change = sector.changePercent ?? 0;
        const width = `${(Math.abs(change) / maxAbs) * 50}%`;
        return (
          <li key={sector.key}>
            <Link href={`/sector/${sector.key}`} className="grid h-7 grid-cols-[minmax(0,7.5rem)_1fr_4.25rem] items-center gap-2 px-3 text-xs hover:bg-hover">
              <span className="truncate text-fg-2">{def?.label[lang] ?? sector.key}</span>
              <span aria-hidden className="relative h-2.5">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
                <span
                  className={change >= 0 ? "absolute inset-y-0 left-1/2 bg-up/70" : "absolute inset-y-0 right-1/2 bg-down/70"}
                  style={{ width }}
                />
              </span>
              <Delta value={sector.changePercent} className="text-right" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
