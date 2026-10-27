import { Suspense } from "react";
import { connection } from "next/server";
import { PageHead } from "@/components/shell/app-shell";
import { ViewSwitch, type ViewItem } from "@/components/shell/page-bits";
import { ChatToday } from "@/components/chat/chat-today";
import { InboxToday } from "@/components/inbox/inbox-today";
import { getDb } from "@/db/client";
import { helpImproveAtlas } from "@/queries/chat";
import { projectReader } from "@/queries/project";
import { requestNow } from "./_lib/clock";
import { ViewerShell } from "./_lib/shell";
import { currentViewer } from "./_lib/viewer";

// Today, in the view that fits the person (A8): an inbox for someone who leads a project (L6b,
// L6c), a chat for someone who reports into them (L1, L18f).
export default function TodayPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" aria-busy="true" />}>
      <Today searchParams={searchParams} />
    </Suspense>
  );
}

const VIEWS: ViewItem[] = [
  { key: "chat", label: "Chat", href: "/?view=chat", icon: "message-13", activeIcon: "message-13-active" },
  { key: "inbox", label: "Inbox", href: "/?view=inbox", icon: "check-13", activeIcon: "check-13" },
];

async function Today({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  // Per request: the viewer, the database and the clock are all read at request time
  await connection();
  const { item, view, c, ask } = await searchParams;
  const viewer = await currentViewer();
  const db = await getDb();
  const reader = await projectReader(db, viewer.id);
  const leads = reader.world.memberships.some((m) => m.personId === viewer.id && m.state === "member" && (m.role === "pm" || m.role === "lead"));
  const at = await requestNow();
  // Phase S: read once for the account menu and the thumbs under each answer
  const helpOn = await helpImproveAtlas(db, viewer.id);
  // A lead starts in the inbox and someone who reports into them in the chat; either can switch (A8)
  const asInbox = view === "inbox" || (view !== "chat" && leads);
  return (
    <ViewerShell breadcrumb={["Intellibus", "Today"]} activeHref="/" helpOn={helpOn}>
      <PageHead title="Today">
        <span className="type-body text-fg-2">{asInbox ? "What needs you, worst first" : "Tell Atlas what you did, or ask it"}</span>
        <div className="flex-1" />
        <ViewSwitch items={VIEWS} active={asInbox ? "inbox" : "chat"} />
      </PageHead>
      {asInbox ? (
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-7 pt-5 pb-7">
          <InboxToday viewerId={viewer.id} selectedId={typeof item === "string" ? item : undefined} at={at} />
        </div>
      ) : (
        <ChatToday viewerId={viewer.id} firstName={viewer.name.split(" ")[0]} conversationId={typeof c === "string" ? c : undefined} ask={ask === "1"} at={at} helpOn={helpOn} />
      )}
    </ViewerShell>
  );
}
