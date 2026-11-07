import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectorView } from "@/components/sector/SectorView";
import { getSector, SECTOR_KEYS } from "@/lib/universe";

interface Props {
  params: Promise<{ key: string }>;
}

export function generateStaticParams() {
  return SECTOR_KEYS.map((key) => ({ key }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  return { title: getSector(key)?.label.en ?? "Sector" };
}

export default async function SectorPage({ params }: Props) {
  const { key } = await params;
  const sector = getSector(key);
  if (!sector) notFound();
  // Keyed so that switching sectors never shows the previous sector's news or quotes while the new ones load.
  return <SectorView key={sector.key} sector={sector} />;
}
