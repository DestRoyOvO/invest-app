"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { DASH, formatInteger } from "@/lib/format";
import { industryName, sectorName } from "@/lib/i18n/yahoo-terms";
import type { StockProfile } from "@/types/api";

function safeWebsite(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function ProfilePanel({ profile, className }: { profile: StockProfile; className?: string }) {
  const { t, lang } = usePrefs();
  const [expanded, setExpanded] = useState(false);
  const website = safeWebsite(profile.website);
  const s = t.stock.stats;

  return (
    <Panel title={t.stock.profile} code="DES" className={className}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-3 py-3 text-xs">
        <div className="min-w-0">
          <dt className="col-head">{s.sector}</dt>
          <dd className="truncate text-fg" title={profile.sector ?? undefined}>
            {profile.sector ? sectorName(profile.sector, lang) : DASH}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="col-head">{s.industry}</dt>
          <dd className="truncate text-fg" title={profile.industry ?? undefined}>
            {profile.industry ? industryName(profile.industry, lang) : DASH}
          </dd>
        </div>
        <div>
          <dt className="col-head">{s.employees}</dt>
          <dd className="num text-fg">{formatInteger(profile.employees, lang)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="col-head">{s.website}</dt>
          <dd className="truncate">
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
                {new URL(website).hostname.replace(/^www\./, "")}
                <ArrowUpRight aria-hidden className="size-3" strokeWidth={1.75} />
              </a>
            ) : (
              DASH
            )}
          </dd>
        </div>
      </dl>
      {profile.summary ? (
        <div className="px-3 py-3">
          <p lang="en" className={expanded ? "text-sm leading-relaxed text-fg-2" : "line-clamp-5 text-sm leading-relaxed text-fg-2"}>
            {profile.summary}
          </p>
          <Button size="sm" variant="ghost" className="mt-1 -ml-2 max-sm:h-10" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? t.common.less : t.common.more}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
