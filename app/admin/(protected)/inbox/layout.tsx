import type { ReactNode } from "react";
import { InboxList } from "./_components/InboxList";

/**
 * 3-column layout: list (360px fixed) | thread (flex) | side panel (320px fixed)
 * List is always visible. Thread+side are rendered by child pages via `children`.
 */
export default function AdminInboxLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Conversation list — fixed 360px ── */}
      <aside className="flex h-full w-[360px] shrink-0 flex-col border-r border-border">
        <InboxList />
      </aside>

      {/* ── Thread + side panel area ── */}
      <div className="flex min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
