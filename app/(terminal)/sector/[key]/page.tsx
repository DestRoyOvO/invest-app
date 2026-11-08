import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectorView } from "@/components/sector/SectorView";
import { requestMessages } from "@/lib/i18n/request";
import { getSector, SECTOR_KEYS } from "@/lib/universe";

interface Props {
  params: Promise<{ key: string }>;
}

export function generateStaticParams() {
  return SECTOR_KEYS.map((key) => ({ key }));
}

/** The sector's name in the reader's language; an unknown key renders the not-found page and gets its title. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  const { lang, t } = await requestMessages();
  return { title: getSector(key)?.label[lang] ?? t.help.notFound.title };
}

export default async function SectorPage({ params }: Props) {
  const { key } = await params;
  const sector = getSector(key);
  if (!sector) notFound();
  // Keyed so that switching sectors never shows the previous sector's news or quotes while the new ones load.
  return <SectorView key={sector.key} sector={sector} />;
}
