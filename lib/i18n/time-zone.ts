import type { Lang } from "@/types/api";

/**
 * A time zone as the reader's language names it: English pages keep the IANA name the device reports ("Asia/Shanghai"),
 * Chinese pages show the zone's Chinese name ("中国标准时间"), or the IANA name when the browser has none.
 */
export function timeZoneLabel(zone: string, lang: Lang, at: number = Date.now()): string {
  if (lang !== "zh") return zone;
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, timeZoneName: "long" }).formatToParts(at);
    return parts.find((part) => part.type === "timeZoneName")?.value || zone;
  } catch {
    return zone;
  }
}
