import type { Metadata } from "next";

import { PortfolioView } from "@/components/portfolio/PortfolioView";
import { parsePortTab } from "@/components/portfolio/port-view";

export const metadata: Metadata = { title: "Portfolio" };

interface Props {
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function PortfolioPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <PortfolioView initialTab={parsePortTab(tab)} />;
}
