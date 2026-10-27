import Link from "next/link";
import { Icon, type IconName } from "./icon";

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  count?: number;
};
export type ClientItem = { label: string; href: string; count: number };
export type Viewer = { name: string; title: string; initials: string };

export type SidebarProps = {
  workspace: string;
  nav: NavItem[];
  clients: ClientItem[];
  internal: NavItem[];
  viewer: Viewer;
  activeHref: string;
};

// D/Sidebar (Figma 41:2607). Sits directly on the canvas, no border.
export function Sidebar({
  workspace,
  nav,
  clients,
  internal,
  viewer,
  activeHref,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-5 px-3 pt-3 pb-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-hover"
      >
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-sm bg-inverse type-label text-on-inverse">
          {workspace.charAt(0).toLowerCase()}
        </span>
        <span className="flex-1 type-body-medium text-fg-1">{workspace}</span>
        <Icon name="chevron-down" />
      </button>

      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-control border border-line bg-panel px-2 py-[7px] text-left"
      >
        <Icon name="sparkles" />
        <span className="flex-1 type-body text-fg-2">Ask Atlas</span>
        <kbd className="rounded-sm border border-line-strong bg-panel px-1.5 py-px font-sans type-micro text-fg-2">
          ⌘K
        </kbd>
      </button>

      <nav aria-label="Main" className="flex w-full flex-col gap-px">
        {nav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={item.href === activeHref}
          />
        ))}
      </nav>

      {clients.length > 0 && (
        <Section title="Clients">
          {clients.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-hover"
            >
              <span
                className="size-2 shrink-0 rounded-[2px] bg-neutral"
                aria-hidden
              />
              <span className="flex-1 type-body text-fg-2">{c.label}</span>
              <span className="type-caption text-fg-3">{c.count}</span>
            </Link>
          ))}
        </Section>
      )}

      {internal.length > 0 && (
        <Section title="Internal">
          {internal.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={item.href === activeHref}
            />
          ))}
        </Section>
      )}

      <div className="flex-1" />

      <div className="flex w-full items-center gap-2 px-2 py-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 type-micro text-fg-2">
          {viewer.initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col whitespace-nowrap">
          <span className="type-label text-fg-1">{viewer.name}</span>
          <span className="type-micro font-normal text-fg-3">
            {viewer.title}
          </span>
        </span>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-sm hover:bg-hover"
        >
          <Icon name="more" />
        </button>
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 ${active ? "bg-hover" : "hover:bg-hover"}`}
    >
      <Icon name={item.icon} />
      <span
        className={`flex-1 type-body-medium ${active ? "text-fg-1" : "text-fg-2"}`}
      >
        {item.label}
      </span>
      {item.count !== undefined && (
        <span className="type-caption text-fg-3">{item.count}</span>
      )}
    </Link>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-px">
      <div className="px-2 py-1 type-micro text-fg-3">{title}</div>
      {children}
    </div>
  );
}
