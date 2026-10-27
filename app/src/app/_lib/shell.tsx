// The shell as the viewer sees it: their projects in the sidebar, their lens in the header, and the
// View as menu. Reads the viewer cookie, so screens render it inside <Suspense> (Cache Components).
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/sidebar";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { projectReader } from "@/queries/project";
import { asOfLabel, requestNow } from "./clock";
import { currentViewer, VIEWERS } from "./viewer";
import { ViewAsMenu } from "./view-as-menu";

export async function ViewerShell({ breadcrumb, activeHref, children }: { breadcrumb: string[]; activeHref: string; children: React.ReactNode }) {
  const viewer = await currentViewer();
  const db = await getDb();
  const reader = await projectReader(db, viewer.id);
  const projects = (await db.select({ id: t.projects.id, name: t.projects.name, customer: t.projects.customer }).from(t.projects).orderBy(t.projects.name)).filter((p) =>
    reader.mayRead(p.id),
  );
  const customers = [...new Set(projects.map((p) => p.customer).filter((c): c is string => !!c))].sort();
  const internal: NavItem[] = projects.filter((p) => !p.customer).map((p) => ({ label: p.name, href: `/projects/${p.id}`, icon: "target" }));

  return (
    <AppShell
      sidebar={{
        workspace: "Intellibus",
        nav: [
          { label: "Today", href: "/", icon: "sun" },
          { label: "Projects", href: "/projects", icon: "grid", count: projects.length },
        ],
        clients: customers.map((c) => ({ label: c, href: `/projects?client=${encodeURIComponent(c)}`, count: projects.filter((p) => p.customer === c).length })),
        internal,
        viewer: { name: viewer.name, title: viewer.title, initials: viewer.initials },
        activeHref,
      }}
      header={{
        breadcrumb,
        asOf: asOfLabel(await requestNow()),
        roleLabel: viewer.lens,
        roleMenu: <ViewAsMenu current={viewer.id} label={viewer.lens} people={VIEWERS.map((v) => ({ id: v.id, name: v.name, initials: v.initials, line: v.menuLine }))} />,
      }}
    >
      {children}
    </AppShell>
  );
}
