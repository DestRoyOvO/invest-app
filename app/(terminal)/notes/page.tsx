import type { Metadata } from "next";

import { NotesView } from "@/components/notes/NotesView";
import { requestMessages } from "@/lib/i18n/request";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await requestMessages();
  return { title: t.notes.title };
}

export default function NotesPage() {
  return <NotesView />;
}
