import { postJson } from "@/lib/api-client";

/** Ends the AI session on this browser (POST /api/auth/logout); the access password unlocks it again. */
export async function lockAi(): Promise<void> {
  await postJson("/api/auth/logout", {});
}
