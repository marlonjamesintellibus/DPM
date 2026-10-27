import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { requestNow } from "@/app/_lib/clock";
import { ViewerShell } from "@/app/_lib/shell";
import { currentViewer } from "@/app/_lib/viewer";
import { PageHead } from "@/components/shell/app-shell";
import { HeadStatus } from "@/components/shell/page-bits";
import { BraidLog } from "@/components/project/braid-log";
import { PlanCard } from "@/components/project/plan-card";
import { getDb } from "@/db/client";
import { dateInZone } from "@/domain/dates";
import { getProject } from "@/queries/project";

// A project with its plan and BRAID log (L14b), read as the viewer: someone not in it gets nothing.
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
  const [{ projectId }, { log }] = await Promise.all([params, searchParams]);
  const viewer = await currentViewer();
  const at = await requestNow();
  const view = await getProject(await getDb(), viewer.id, projectId, at);
  if (!view.found) notFound();
  const because = view.displayed.from === "set" ? (view.reason?.text.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()) ?? null) : null;
  return (
    <ViewerShell breadcrumb={[view.project.customer ?? "Internal", view.project.name]} activeHref={`/projects/${projectId}`}>
      <PageHead title={view.project.name}>
        <HeadStatus status={view.displayed.status} label={view.displayed.label} because={because} />
        {view.displayed.from === "set" && <span className="shrink-0 type-caption whitespace-nowrap text-fg-3">set by {view.setStatus?.setBy?.name.split(" ")[0]}; the plan says {view.calculated.label}</span>}
      </PageHead>
      <div className="flex flex-1 flex-col gap-4 overflow-auto px-7 pt-5 pb-7">
        <PlanCard view={view} today={dateInZone(at, "America/Jamaica")} />
        <BraidLog view={view} filter={typeof log === "string" ? log : undefined} at={at} basePath={`/projects/${projectId}`} />
      </div>
    </ViewerShell>
  );
}
