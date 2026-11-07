import "server-only";

import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { load, type CheerioAPI } from "cheerio/slim";

// SSRF-safe article reader for news analysis.
//
// Controls, in order of importance:
// 1. Host allowlist of public news domains, https only, default port, no credentials (the primary control).
// 2. Every resolved address must be public: private, loopback, link-local, CGNAT, multicast, reserved,
//    unique-local and IPv4-mapped/NAT64 forms of those are rejected.
// 3. Redirects are followed manually (at most 3) and every hop is validated again.
// 4. One 6 s deadline covers DNS, headers and body; at most 2 MB of (decompressed) body is read; HTML only.
//
// The address check runs inside the socket's own DNS lookup (a custom `lookup` for node:https), so the address
// that was validated is the address that gets connected to. That closes the DNS-rebinding gap a separate
// "resolve, check, then fetch" sequence would leave. node:https is used instead of fetch because fetch cannot pin
// the lookup, and its 16 KB response-header limit rejects Yahoo Finance pages (about 35 KB of headers).
// No third-party reader proxies are used.

export const ARTICLE_USER_AGENT = "Mozilla/5.0 (compatible; InvestSeek/1.0; research reader)";
export const MAX_ARTICLE_CHARS = 6_000;

const ARTICLE_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_URL_LENGTH = 2_048;
const MIN_ARTICLE_CHARS = 200;
const MIN_PARAGRAPH_CHARS = 40;

/** Registrable domains whose hosts (and subdomains) may be fetched. */
const ALLOWED_DOMAINS: readonly string[] = [
  // Yahoo: nearly all Yahoo Finance news links point to finance.yahoo.com.
  "yahoo.com",
  // Wires and business press.
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "barrons.com",
  "marketwatch.com",
  "cnbc.com",
  "foxbusiness.com",
  "businessinsider.com",
  "forbes.com",
  "fortune.com",
  "economist.com",
  "axios.com",
  "nytimes.com",
  "washingtonpost.com",
  "cnn.com",
  "bbc.com",
  "bbc.co.uk",
  "theguardian.com",
  // Investing and market research sites.
  "fool.com",
  "benzinga.com",
  "investopedia.com",
  "seekingalpha.com",
  "nasdaq.com",
  "thestreet.com",
  "investors.com",
  "zacks.com",
  "morningstar.com",
  "kiplinger.com",
  "investorplace.com",
  "247wallst.com",
  "gurufocus.com",
  "tipranks.com",
  "marketbeat.com",
  "simplywall.st",
  "insidermonkey.com",
  "investing.com",
  "fxstreet.com",
  // Press-release wires.
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "accessnewswire.com",
  // Technology and crypto press frequently syndicated by Yahoo Finance.
  "techcrunch.com",
  "theverge.com",
  "coindesk.com",
  "decrypt.co",
];

/** Yahoo consent walls (EU visitors are redirected here instead of to the article). */
const CONSENT_DOMAINS: readonly string[] = ["consent.yahoo.com", "guce.yahoo.com"];

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

export function isAllowedArticleHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return ALLOWED_DOMAINS.some((domain) => matchesDomain(host, domain));
}

export function isConsentHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return CONSENT_DOMAINS.some((domain) => matchesDomain(host, domain));
}

/** The URL if it may be fetched (https, allowlisted host, default port, no credentials), otherwise null. */
export function parseArticleUrl(input: string | URL): URL | null {
  if (typeof input === "string" && input.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(typeof input === "string" ? input.trim() : input.href);
  } catch {
    return null;
  }
  if (url.href.length > MAX_URL_LENGTH) return null;
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  if (!isAllowedArticleHost(url.hostname) || isConsentHost(url.hostname)) return null;
  url.hash = "";
  return url;
}

// ---------------------------------------------------------------------------
// IP address classification
// ---------------------------------------------------------------------------

/** Dotted-quad IPv4 as an unsigned integer, or null. */
export function parseIPv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** IPv6 (with "::" compression, an embedded IPv4 tail or a zone id) as eight 16-bit groups, or null. */
export function parseIPv6(text: string): number[] | null {
  let input = text.trim();
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
  const zone = input.indexOf("%");
  if (zone !== -1) input = input.slice(0, zone);
  if (input.length < 2 || input.length > 45) return null;

  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const v4 = lastColon === -1 ? null : parseIPv4(input.slice(lastColon + 1));
    if (v4 === null) return null;
    input = `${input.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const halves = input.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = parseGroups(input);
    return groups && groups.length === 8 ? groups : null;
  }
  const head = parseGroups(halves[0]);
  const tail = parseGroups(halves[1]);
  if (!head || !tail || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network", including the unspecified address
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata endpoints
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including the broadcast address
];

const BLOCKED_IPV4_RANGES = BLOCKED_IPV4.map(([base, prefix]) => {
  const size = 2 ** (32 - prefix);
  const start = Math.floor((parseIPv4(base) ?? 0) / size) * size;
  return { start, end: start + size - 1 };
});

function isPublicIPv4(value: number): boolean {
  return !BLOCKED_IPV4_RANGES.some((range) => value >= range.start && value <= range.end);
}

function isPublicIPv6(g: number[]): boolean {
  const zeroGroups = (from: number, to: number) => g.slice(from, to).every((group) => group === 0);
  const embeddedV4 = g[6] * 65536 + g[7];

  // IPv4-mapped addresses (::ffff:0:0/96) and the NAT64 well-known prefix (64:ff9b::/96) carry an IPv4 address.
  if (zeroGroups(0, 5) && g[5] === 0xffff) return isPublicIPv4(embeddedV4);
  if (g[0] === 0x64 && g[1] === 0xff9b && zeroGroups(2, 6)) return isPublicIPv4(embeddedV4);

  // Only global unicast (2000::/3) can be public. This excludes ::, ::1, IPv4-compatible addresses, fc00::/7,
  // fe80::/10, fec0::/10, ff00::/8, 100::/64 and 64:ff9b:1::/48.
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 protocol assignments (Teredo, benchmarking, ORCHID)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return false; // 6to4, which embeds an arbitrary IPv4 address
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

/** True only for globally routable unicast addresses. Anything unparsable counts as not public. */
export function isPublicIpAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4 !== null) return isPublicIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 !== null && isPublicIPv6(v6);
}

// ---------------------------------------------------------------------------
// Validating DNS lookup
// ---------------------------------------------------------------------------

export type HostResolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: HostResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

function errorWithCode(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

/**
 * A `lookup` for node:net/https that refuses hosts resolving to any non-public address. Every answer must be
 * public, so a mixed answer cannot be used to reach an internal address.
 */
export function createSafeLookup(resolve: HostResolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    const fail = (error: NodeJS.ErrnoException) => callback(error, options.all ? [] : "");
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return fail(errorWithCode("ENOTFOUND", `No addresses for ${hostname}`));
        if (addresses.some((entry) => !isPublicIpAddress(entry.address))) {
          return fail(errorWithCode("ERR_ARTICLE_BLOCKED_ADDRESS", `${hostname} resolves to a non-public address`));
        }
        const family =
          options.family === 4 || options.family === "IPv4" ? 4 : options.family === 6 || options.family === "IPv6" ? 6 : 0;
        const candidates = family === 0 ? addresses : addresses.filter((entry) => entry.family === family);
        if (candidates.length === 0) return fail(errorWithCode("ENOTFOUND", `No IPv${family} address for ${hostname}`));
        if (options.all) callback(null, candidates);
        else callback(null, candidates[0].address, candidates[0].family);
      },
      (error: unknown) => fail(error instanceof Error ? (error as NodeJS.ErrnoException) : errorWithCode("ENOTFOUND", String(error))),
    );
  };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface ArticleResponse {
  status: number;
  location: string | null;
  contentType: string | null;
  /** Decoded body, read only for 2xx HTML responses (at most 2 MB). */
  body: string | null;
}

/** Performs one GET without following redirects. Replaced in tests. */
export type ArticleTransport = (url: URL, signal: AbortSignal) => Promise<ArticleResponse>;

export function isHtmlContentType(contentType: string | null): boolean {
  return /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(contentType ?? "");
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function firstHeader(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first.trim() : null;
}

const DECODERS: Readonly<Record<string, () => Transform>> = {
  gzip: createGunzip,
  "x-gzip": createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
};

function decodeText(bytes: Buffer, contentType: string | null): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? "")?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // unknown charset label
  }
}

async function readBody(res: IncomingMessage, contentType: string | null, signal: AbortSignal): Promise<string | null> {
  const encoding = (firstHeader(res.headers["content-encoding"]) ?? "identity").toLowerCase();
  const createDecoder: (() => Transform) | undefined = DECODERS[encoding];
  if (encoding !== "identity" && !createDecoder) {
    res.destroy();
    return null;
  }
  const decoder = createDecoder?.();
  const source: Readable = decoder ? res.pipe(decoder) : res;
  if (decoder) res.once("error", (error) => decoder.destroy(error));
  const onAbort = () => res.destroy(errorWithCode("ABORT_ERR", "Article request aborted"));
  signal.addEventListener("abort", onAbort, { once: true });

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      const room = MAX_BODY_BYTES - size;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(part);
      size += part.length;
      if (size >= MAX_BODY_BYTES) break; // keep the first 2 MB, which holds the article text
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    res.destroy();
  }
  return decodeText(Buffer.concat(chunks), contentType);
}

const REQUEST_HEADERS = {
  "User-Agent": ARTICLE_USER_AGENT,
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  "Accept-Language": "en-US,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
};

const safeLookup = createSafeLookup();

const httpsTransport: ArticleTransport = (url, signal) =>
  new Promise<ArticleResponse>((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: "GET", headers: REQUEST_HEADERS, lookup: safeLookup, maxHeaderSize: MAX_HEADER_BYTES, signal, agent: false },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = firstHeader(res.headers.location);
        const contentType = firstHeader(res.headers["content-type"]);
        if (status < 200 || status >= 300 || !isHtmlContentType(contentType)) {
          res.destroy(); // redirects and errors carry no body worth reading
          resolve({ status, location, contentType, body: null });
          return;
        }
        readBody(res, contentType, signal).then((body) => resolve({ status, location, contentType, body }), reject);
      },
    );
    req.on("error", reject);
    req.end();
  });

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const NOISE_SELECTOR =
  "script, style, noscript, template, svg, iframe, nav, header, footer, aside, form, button, figure, [class*='tooltip']";

/** Article containers, most specific first. */
const CONTENT_SELECTORS = [
  ".article-wrap .body", // Yahoo Finance
  ".caas-body", // Yahoo (older layout)
  "[itemprop='articleBody']",
  "[data-testid='article-body']",
  ".article-body",
  ".article__body",
  "article",
  "main",
  "body",
];

function isConsentUrl(value: string): boolean {
  try {
    return isConsentHost(new URL(value).hostname);
  } catch {
    return false; // relative or malformed action: not a Yahoo consent endpoint
  }
}

/** Yahoo consent walls render a form that posts to the consent host. (Normal pages mention guce.yahoo.com in a meta tag.) */
function hasConsentForm($: CheerioAPI): boolean {
  return $("form[action]")
    .toArray()
    .some((form) => isConsentUrl($(form).attr("action") ?? ""));
}

function collectParagraphs($: CheerioAPI, selector: string): string[] {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  $(selector)
    .first()
    .find("p")
    .each((_, element) => {
      const text = $(element).text().replace(/\s+/g, " ").trim();
      if (text.length >= MIN_PARAGRAPH_CHARS && !seen.has(text)) {
        seen.add(text);
        paragraphs.push(text);
      }
    });
  return paragraphs;
}

function joinWithinLimit(paragraphs: string[], maxChars: number): string {
  let text = "";
  for (const paragraph of paragraphs) {
    const separator = text ? "\n\n" : "";
    if (text.length + separator.length + paragraph.length <= maxChars) {
      text += separator + paragraph;
      continue;
    }
    const room = maxChars - text.length - separator.length;
    if (room > MIN_PARAGRAPH_CHARS) {
      const cut = paragraph.slice(0, room - 1);
      const lastSpace = cut.lastIndexOf(" ");
      text += `${separator}${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
    }
    break;
  }
  return text;
}

/** Readable paragraphs of an article page (at most 6000 characters), or null for consent walls and thin pages. */
export function extractArticleText(html: string): string | null {
  const $ = load(html);
  if (hasConsentForm($)) return null;
  $(NOISE_SELECTOR).remove();
  for (const selector of CONTENT_SELECTORS) {
    const text = joinWithinLimit(collectParagraphs($, selector), MAX_ARTICLE_CHARS);
    if (text.length >= MIN_ARTICLE_CHARS) return text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface FetchArticleOptions {
  signal?: AbortSignal;
  /** Test seam; defaults to node:https with the validating lookup. */
  transport?: ArticleTransport;
}

function describeFailure(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string") return code;
    if (typeof name === "string") return name;
  }
  return "unknown";
}

/**
 * Fetches an allowlisted news article and returns its readable text (at most 6000 characters).
 * Returns null whenever the text cannot be obtained safely: disallowed URL or redirect, non-public address,
 * consent wall, non-HTML response, timeout, or a page without enough readable text.
 */
export async function fetchArticleText(input: string, options: FetchArticleOptions = {}): Promise<string | null> {
  let url = parseArticleUrl(input);
  if (!url) return null;
  const transport = options.transport ?? httpsTransport;
  const deadline = AbortSignal.timeout(ARTICLE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (signal.aborted) return null;
      const response = await transport(url, signal);
      if (isRedirect(response.status)) {
        if (hop === MAX_REDIRECTS || !response.location) return null;
        let next: URL;
        try {
          next = new URL(response.location, url);
        } catch {
          return null;
        }
        if (isConsentHost(next.hostname)) return null;
        const validated = parseArticleUrl(next);
        if (!validated) return null;
        url = validated;
        continue;
      }
      if (response.status < 200 || response.status >= 300) return null;
      if (!isHtmlContentType(response.contentType) || response.body === null) return null;
      return extractArticleText(response.body);
    }
    return null;
  } catch (error) {
    console.warn("[article] fetch failed", { host: url.hostname, reason: describeFailure(error) });
    return null;
  }
}
