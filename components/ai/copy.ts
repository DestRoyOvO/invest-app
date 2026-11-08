import type { AiFailure } from "@/hooks/useAiStream";
import { aiWait } from "@/lib/ai-wait";
import { tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";

// Words for AI states shared by the note panels, the chat and the unlock form.

/** "45 s", "3 min" or "5 h", rounded up. */
export function waitText(retryAfterSeconds: number | undefined, t: Messages): string {
  const wait = aiWait(retryAfterSeconds);
  return tpl(t.ai.wait[wait.unit], { n: wait.value });
}

export function failureText(failure: AiFailure, t: Messages): string {
  switch (failure.kind) {
    case "rate_limited":
      return tpl(failure.daily ? t.ai.dailyLimit : t.ai.rateLimited, { wait: waitText(failure.retryAfter, t) });
    case "interrupted":
      return t.ai.interrupted;
    case "model_limit":
      return t.ai.modelLimit;
    case "unavailable":
      return t.ai.unavailable;
    case "not_configured":
      return t.ai.notConfigured;
    case "rejected":
      return t.ai.providerRejected;
    case "locked":
      return t.ai.lockedTitle;
    default:
      return t.ai.failed;
  }
}
