// The zod schema of a backup file (see lib/backup.ts for the format). validateBackup loads this module on demand, so
// zod reaches the browser only when a file is checked; the named imports let the bundler leave out the parts of zod
// the schema does not use.

import { iso, json, literal, object, record, string } from "zod";

import { BACKUP_APP, BACKUP_SCHEMA, COOKIE_VALUE, MAX_TEXT_CHARS } from "@/lib/backup";
import { STORAGE_PREFIX } from "@/lib/local-store";

const storageKey = string()
  .max(200)
  .refine((key) => key.startsWith(STORAGE_PREFIX));
const cookieValue = string().regex(COOKIE_VALUE).optional();

export const backupFileSchema = object({
  app: literal(BACKUP_APP),
  schema: literal(BACKUP_SCHEMA),
  exportedAt: iso.datetime({ offset: true }),
  data: object({
    storage: record(storageKey, json()).default({}),
    text: record(storageKey, string().max(MAX_TEXT_CHARS)).default({}),
    cookies: object({ is_lang: cookieValue, is_theme: cookieValue, is_updown: cookieValue, is_density: cookieValue }).default({}),
  }),
});
