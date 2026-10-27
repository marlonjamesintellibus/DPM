import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { requestNow } from "@/app/_lib/clock";
import { ViewerShell } from "@/app/_lib/shell";
import { currentViewer } from "@/app/_lib/viewer";
import { PageHead } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/controls";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { getProject, projectReader } from "@/queries/project";

// The projects the viewer can read (P10), with the status each one shows. No Figma frame of its
// own in this slice: it uses the cards and pills of L14b.
export default function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" aria-busy="true" />}>
      <Projects searchParams={searchParams} />
    </Suspense>
  );
}

async function Projects({ searchParams }: { searchParams: PageProps<"/projects">["searchParams"] }) {
  // Per request: the viewer, the database and the clock are all read at request time
  await connection();
  const { client } = await searchParams;
  const viewer = await currentViewer();
  const db = await getDb();
  const reader = await projectReader(db, viewer.id);
  const rows = (await db.select({ id: t.projects.id, name: t.projects.name, customer: t.projects.customer }).from(t.projects).orderBy(t.projects.name)).filter(
    (p) => reader.mayRead(p.id) && (!client || p.customer === client),
  );
  const at = await requestNow();
  const views = await Promise.all(rows.map((p) => getProject(db, viewer.id, p.id, at)));
  return (
    <ViewerShell breadcrumb={client ? ["Projects", String(client)] : ["Projects"]} activeHref="/projects">
      <PageHead title={client ? String(client) : "Projects"}>
        <span className="type-body text-fg-2">{rows.length} you can see</span>
      </PageHead>
      <ul className="flex flex-col gap-2 px-7 pt-5 pb-7">
        {views.map((v) =>
          v.found ? (
            <li key={v.project.id}>
              <Link href={`/projects/${v.project.id}`} className="flex items-center gap-3 rounded-md border border-line bg-panel px-4 py-3 hover:bg-hover">
                <span className="flex-1 type-body-medium text-fg-1">{v.project.name}</span>
                <span className="type-caption text-fg-3">{v.project.customer ?? "Internal"}</span>
                <span className="type-caption text-fg-3">{v.braid.waitingForApproval ? `${v.braid.waitingForApproval} waiting for approval` : ""}</span>
                <StatusPill status={v.displayed.status} label={v.displayed.label} />
              </Link>
            </li>
          ) : null,
        )}
      </ul>
    </ViewerShell>
  );
}
