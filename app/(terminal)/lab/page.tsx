import type { Metadata } from "next";

import { LabView } from "@/components/lab/LabView";

export const metadata: Metadata = {
  title: "Factor lab",
  description: "What the prices in InvestSeek can and cannot forecast: pre-registered factor tests, the track record of the technical reading and the calibration of the risk forecast.",
};

export default function LabPage() {
  return <LabView />;
}
