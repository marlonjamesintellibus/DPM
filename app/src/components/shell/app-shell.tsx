import { Header, type HeaderProps } from "./header";
import { Sidebar, type SidebarProps } from "./sidebar";

// The canvas with the sidebar on it, and the inset panel beside it (L16: "Panel wrap" and "Panel").
export function AppShell({
  sidebar,
  header,
  children,
}: {
  sidebar: SidebarProps;
  header: HeaderProps;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-screen bg-canvas">
      <Sidebar {...sidebar} />
      <div className="flex min-w-0 flex-1 flex-col py-2 pr-2">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-panel">
          <Header {...header} />
          {children}
        </main>
      </div>
    </div>
  );
}

// Page head under the header: D/Title plus an optional line (L16 "Page head").
export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-7 pt-[18px] pb-3.5">
      <h1 className="shrink-0 type-title whitespace-nowrap text-fg-1">{title}</h1>
      {children}
    </div>
  );
}
