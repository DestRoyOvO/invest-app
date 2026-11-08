"use client";

import { useAlertEngine, useAlertToasts } from "@/hooks/useAlertEngine";

/**
 * Evaluates the investor's local alert rules against live quotes while the app is open (mounted once in the shell).
 * One tab checks and sends system notifications (hooks/useAlertEngine.ts); every tab shows new triggers as toasts.
 */
export function AlertEngine() {
  useAlertEngine();
  useAlertToasts();
  return null;
}
