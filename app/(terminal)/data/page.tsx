import type { Metadata } from "next";

import { DataView } from "@/components/data/DataView";

export const metadata: Metadata = { title: "Your data" };

export default function DataPage() {
  return <DataView />;
}
