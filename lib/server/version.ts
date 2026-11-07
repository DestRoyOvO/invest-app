import "server-only";

import packageJson from "@/package.json";

/** Version of the running build, from package.json (shown by /api/health and the startup log). */
export const APP_VERSION: string = packageJson.version;
