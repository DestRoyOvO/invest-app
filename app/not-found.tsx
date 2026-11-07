import type { Metadata } from "next";

import { NotFoundView } from "@/components/shell/NotFoundView";
import { TerminalShell } from "@/components/shell/TerminalShell";

export const metadata: Metadata = { title: "Not found" };

/** Unknown URLs render inside the terminal shell, so the command bar, navigation and shortcuts stay at hand. */
export default function NotFound() {
  return (
    <TerminalShell>
      <NotFoundView />
    </TerminalShell>
  );
}
