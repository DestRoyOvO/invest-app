import type { Metadata } from "next";

import { CalendarView } from "@/components/calendar/CalendarView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.calendar.title };
}

export default function CalendarPage() {
  return <CalendarView />;
}
