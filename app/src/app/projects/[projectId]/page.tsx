import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { requestNow } from "@/app/_lib/clock";
import { ViewerShell } from "@/app/_lib/shell";
import { currentViewer } from "@/app/_lib/viewer";
import { PageHead } from "@/components/shell/app-shell";
import { HeadStatus, ViewSwitch } from "@/components/shell/page-bits";
import { BraidSummary } from "@/components/project/braid-summary";
import { BraidTable } from "@/components/project/braid-table";
import { ContactsCard } from "@/components/project/contacts-card";
import { MilestoneCard } from "@/components/project/milestone-card";
import { PauseControl } from "@/components/project/pause-control";
import { PlanCard } from "@/components/project/plan-card";
import { getDb } from "@/db/client";
import { dateInZone } from "@/domain/dates";
import { contactsOf } from "@/queries/client-view";
import { getProject } from "@/queries/project";

// A project as the viewer reads it, in two views (A8): the Dashboard (L14d: the plan, the BRAID summary
// and the milestones, and its contacts with the PM's client view switch, CD49) and the Table (L14c: the
// BRAID log, where kinds are switched and entries approved). Someone not in the project gets nothing.
export default function ProjectPage({ params, searchParams }: PageProps<"/projects/[projectId]">) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" aria-busy="true" />}>
      <Project params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Project({ params, searchParams }: { params: PageProps<"/projects/[projectId]">["params"]; searchParams: PageProps<"/projects/[projectId]">["searchParams"] }) {
  // Per request: the viewer, the database and the clock are all read at request time
  await connection();
  const [{ projectId }, { log, view: shown }] = await Promise.all([params, searchParams]);
  const table = shown === "table";
  const viewer = await currentViewer();
  const at = await requestNow();
  const db = await getDb();
  const view = await getProject(db, viewer.id, projectId, at);
  if (!view.found) notFound();
  const contacts = table ? [] : await contactsOf(db, viewer.id, projectId);
  const base = `/projects/${projectId}`;
  const because = view.displayed.from === "set" ? (view.reason?.text.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()) ?? null) : null;
  return (
    <ViewerShell breadcrumb={[view.project.customer ?? "Internal", view.project.name]} activeHref={`/projects/${projectId}`}>
      <PageHead title={view.project.name}>
        <HeadStatus status={view.displayed.status} label={view.displayed.label} because={because} />
        {view.displayed.from === "set" && <span className="shrink-0 type-caption whitespace-nowrap text-fg-3">set by {view.setStatus?.setBy?.name.split(" ")[0]}; the plan says {view.calculated.label}</span>}
        <div className="flex-1" />
        {view.viewerRole === "pm" && <PauseControl projectId={view.project.id} paused={view.project.paused} />}
        <ViewSwitch
          active={table ? "table" : "dashboard"}
          items={[
            { key: "dashboard", label: "Dashboard", href: base, icon: "grid-13", activeIcon: "grid-13-active" },
            { key: "table", label: "Table", href: `${base}?view=table`, icon: "table-13", activeIcon: "table-13" },
          ]}
        />
      </PageHead>
      {table ? (
        <div className="flex min-h-0 flex-1 flex-col px-7 pt-5 pb-7">
          <BraidTable view={view} filter={typeof log === "string" ? log : undefined} basePath={`${base}?view=table`} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-auto px-7 pt-5 pb-7">
          <PlanCard view={view} today={dateInZone(at, "America/Jamaica")} />
          <div className="flex shrink-0 flex-col items-stretch gap-4 xl:flex-row xl:items-start">
            <BraidSummary view={view} tableHref={`${base}?view=table`} />
            <div className="flex shrink-0 flex-col gap-4 xl:w-[520px]">
              <MilestoneCard view={view} />
              <ContactsCard projectId={view.project.id} projectName={view.project.name} contacts={contacts} isPm={view.viewerRole === "pm"} />
            </div>
          </div>
        </div>
      )}
    </ViewerShell>
  );
}
