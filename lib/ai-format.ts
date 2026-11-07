// Compact English formatting and sanitizing for the AI context (lib/server/ai-context.ts and the lib/ai-*.ts block
// builders). The model reads these strings, so they are plain, unit-carrying and stable: "+1.23%", "25.3%", "54.2x",
// "$4.61T", ISO dates. The model translates when it writes in Chinese.

export const NA = "n/a";

/** Delimiters the system prompt tells the model to treat as third-party data, never as instructions. */
export const UNTRUSTED_OPEN = "<untrusted_data>";
export const UNTRUSTED_CLOSE = "</untrusted_data>";

export function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(value)) return NA;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return NA;
  return fmtNumber(value, Math.abs(value) >= 1 ? 2 : 4);
}

/** Percent units: 1.234 -> "+1.23%". */
export function fmtChangePercent(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return NA;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Decimal ratio: 0.2534 -> "25.3%" (or "+25.3%" when signed). */
export function fmtRatio(value: number | null | undefined, digits = 1, signed = false): string {
  if (!isFiniteNumber(value)) return NA;
  return `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

export function fmtMultiple(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value.toFixed(1)}x` : NA;
}

/** A signed amount with two decimals: 412.3 -> "+412.30", -80 -> "-80.00". */
export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(value)) return NA;
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value), digits)}`;
}

/** Percentage points between two percent-unit changes: 1.33 -> "+1.33 pt". */
export function fmtPoints(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return NA;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} pt`;
}

/** 4.61e12 -> "4.61T"; with USD -> "$4.61T"; other currencies are suffixed. */
export function fmtCompact(value: number | null | undefined, currency?: string | null): string {
  if (!isFiniteNumber(value)) return NA;
  const abs = Math.abs(value);
  const [divisor, unit] = abs >= 1e12 ? [1e12, "T"] : abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const amount = `${(value / divisor).toFixed(divisor === 1 ? 0 : 2)}${unit}`;
  if (!currency) return amount;
  return currency === "USD" ? `${value < 0 ? "-" : ""}$${amount.replace("-", "")}` : `${amount} ${currency}`;
}

/** ISO timestamp to minute precision, e.g. "2026-11-07T14:05Z". */
export function fmtTime(iso: string | null | undefined): string {
  return iso && iso.length >= 16 ? `${iso.slice(0, 16)}Z` : NA;
}

export function fmtDate(iso: string | null | undefined): string {
  return iso && iso.length >= 10 ? iso.slice(0, 10) : NA;
}

/** Whole percent of a 0..1 share: 0.314 -> "31%". */
export function fmtShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** "label value" pairs joined by commas, skipping missing values. */
export function pairs(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries
    .filter(([, value]) => value !== NA)
    .map(([label, value]) => `${label} ${value}`)
    .join(", ");
}

/** Third-party strings shown inline (names, reasons): no control or format characters, angle brackets or line breaks. */
export function cleanInline(value: string | null | undefined, maxChars = 80): string {
  if (!value) return "";
  const text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/[<>\uFF1C\uFF1E\uFE64\uFE65]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * Wraps third-party text in the delimiters the system prompt tells the model to treat as data.
 * Angle brackets (and their full-width and small look-alikes) are replaced so the text can neither close the block
 * nor open a fake one.
 */
export function untrusted(text: string): string {
  const safe = text
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === "\n" ? "\n" : " "))
    .replace(/[<\uFF1C\uFE64]/g, "‹")
    .replace(/[>\uFF1E\uFE65]/g, "›")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${UNTRUSTED_OPEN}\n${safe}\n${UNTRUSTED_CLOSE}`;
}

/** Clips text to `maxChars`, ending at a sentence or word boundary when one is close. */
export function clip(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars - 1);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"));
  const word = cut.lastIndexOf(" ");
  const end = sentence > maxChars * 0.5 ? sentence + 1 : word > maxChars * 0.6 ? word : cut.length;
  return `${cut.slice(0, end).trimEnd()}…`;
}

const DAY_MS = 86_400_000;

/** Whole calendar days from `now` to an ISO date (negative when it is past), compared on UTC dates. */
export function daysUntil(iso: string, now: Date): number | null {
  const target = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - today) / DAY_MS);
}

/** "in 12 days" / "tomorrow" / "today" / "3 days ago". */
export function fmtDaysUntil(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** English ordinal of a whole number: 1 -> "1st", 12 -> "12th", 73 -> "73rd". */
export function ordinal(value: number): string {
  const n = Math.round(value);
  const mod100 = Math.abs(n) % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[Math.abs(n) % 10] ?? "th";
  return `${n}${suffix}`;
}
