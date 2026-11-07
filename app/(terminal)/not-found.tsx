import { NotFoundView } from "@/components/shell/NotFoundView";

/** notFound() inside a terminal page: the shell around it comes from app/(terminal)/layout.tsx. */
export default function TerminalNotFound() {
  return <NotFoundView />;
}
