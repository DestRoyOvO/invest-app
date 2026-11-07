// Public site settings read from the environment.

/**
 * The public origin from SITE_URL (e.g. "https://investseek.example"), used to make social-card URLs absolute.
 * Anything that is not an http(s) URL is ignored, so a typo never breaks rendering.
 */
export function parseSiteUrl(raw: string | undefined): URL | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}
