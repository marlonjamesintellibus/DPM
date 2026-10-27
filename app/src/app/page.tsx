import { AppShell, PageHead } from "@/components/shell/app-shell";
import { employeeHeader, kemarSidebar } from "./shell-placeholder";

export default function TodayPage() {
  return (
    <AppShell
      sidebar={{ ...kemarSidebar, activeHref: "/" }}
      header={{ ...employeeHeader, breadcrumb: ["Intellibus", "Today"] }}
    >
      <PageHead title="Today" />
      <div className="flex flex-1 flex-col gap-4 px-7 pt-5 pb-7">
        <p className="type-caption text-fg-3">Your next things will show here once Atlas has something for you.</p>
      </div>
    </AppShell>
  );
}
