"use client";

import { Lock } from "lucide-react";

import { useT } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { AiChip } from "@/components/ui/Badge";
import { useAuthStatus } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import type { AuthStatus } from "@/types/api";

export type AiState = "available" | "locked" | "disabled" | "notConfigured" | "unknown";

export function aiStateOf(status: AuthStatus | undefined): AiState {
  if (!status) return "unknown";
  if (status.aiAvailable) return "available";
  if (!status.aiConfigured) return "notConfigured";
  if (status.authRequired && !status.authenticated) return "locked";
  return "disabled";
}

/**
 * Compact AI status chip; opens the assistant (which shows the unlock form when locked). The AI chip already says
 * "AI", so the visible text after it is the bare state ("ready"), which keeps the accessible name starting with the
 * visible label (WCAG 2.5.3) without showing the word twice.
 */
export function AiStatusButton({ className }: { className?: string }) {
  const t = useT();
  const { openChat } = useUi();
  const { data } = useAuthStatus();
  const state = aiStateOf(data);
  if (state === "unknown") return null;
  const ai = t.shell.ai;
  const label = state === "available" ? ai.available : state === "locked" ? ai.locked : state === "notConfigured" ? ai.notConfigured : ai.disabled;
  const status = state === "available" ? ai.status.available : state === "notConfigured" ? ai.status.notConfigured : ai.status.disabled;
  return (
    <button
      type="button"
      onClick={() => openChat()}
      title={label}
      aria-label={`${label}. ${t.ai.chat.open}`}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-xs border px-2 text-xs transition-colors",
        state === "available" ? "border-line-2 text-fg-2 hover:bg-hover hover:text-fg" : "border-line-2 text-fg-3 hover:bg-hover",
        className,
      )}
    >
      {state === "locked" ? (
        <>
          <Lock aria-hidden className="size-3.5 text-warn" strokeWidth={1.75} />
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        <>
          <AiChip tone={state === "available" ? "accent" : "muted"} />{" "}
          <span className="hidden sm:inline">{status}</span>
        </>
      )}
    </button>
  );
}
