import type { ReactNode } from "react";

import { TerminalShell } from "@/components/shell/TerminalShell";
import { readEnv } from "@/lib/server/env";

export default function TerminalLayout({ children }: { children: ReactNode }) {
  // Read per request (the root layout reads cookies, so every page renders dynamically): one build serves both modes.
  return <TerminalShell dataSource={readEnv().marketDataSource}>{children}</TerminalShell>;
}
