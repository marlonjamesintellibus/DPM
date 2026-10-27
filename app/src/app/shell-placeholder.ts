import type { HeaderProps } from "@/components/shell/header";
import type { SidebarProps } from "@/components/shell/sidebar";

// Phase 0 only: the shell as Kemar sees it in L16. Phase 3 replaces this with
// queries scoped to the viewer (build-plan.md, section 3).
export const SNAPSHOT_AS_OF = "Tue 20 Oct · 9:10am";

export const kemarSidebar: Omit<SidebarProps, "activeHref"> = {
  workspace: "Intellibus",
  nav: [
    { label: "Today", href: "/", icon: "sun" },
    { label: "Projects", href: "/projects", icon: "grid", count: 17 },
  ],
  clients: [{ label: "Sprouts", href: "/clients/sprouts", count: 5 }],
  internal: [{ label: "GQ & Academy", href: "/internal/gq-academy", icon: "target" }],
  viewer: { name: "Kemar Brown", title: "Data engineer", initials: "KB" },
};

export const employeeHeader: Omit<HeaderProps, "breadcrumb"> = {
  asOf: SNAPSHOT_AS_OF,
  roleLabel: "Employee view",
};
