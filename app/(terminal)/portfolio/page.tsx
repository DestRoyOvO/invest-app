import type { Metadata } from "next";

import { PortfolioView } from "@/components/portfolio/PortfolioView";

export const metadata: Metadata = { title: "Portfolio" };

// The tab (?tab=overview|exposure|risk|correlation) is read on the client with useSearchParams, so client-side
// navigation to /portfolio?tab=correlation (the CORR function code) switches tabs on a page that is already open.
export default function PortfolioPage() {
  return <PortfolioView />;
}
