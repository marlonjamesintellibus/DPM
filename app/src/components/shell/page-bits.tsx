// Pieces of the page head in Variation L: the overall status pill ("● At risk because ...") and the
// view switch (A8: Chat, Inbox). Only the views built in this slice are offered.
import Link from "next/link";
import { StatusMark } from "@/components/ui/controls";
import type { Status } from "@/domain/status/status";
import { Icon, type IconName } from "./icon";

export function HeadStatus({ status, label, because }: { status: Status | null; label: string; because?: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-line px-2.5 py-1">
      <span className="shrink-0 whitespace-nowrap">
        <StatusMark status={status} label={label} />
      </span>
      {because && <span className="min-w-0 truncate type-body text-fg-2">because {because}</span>}
    </span>
  );
}

export type ViewItem = { key: string; label: string; href: string; icon: IconName; activeIcon: IconName };

export function ViewSwitch({ items, active }: { items: ViewItem[]; active: string }) {
  return (
    <nav aria-label="View" className="flex shrink-0 gap-0.5 rounded-control bg-panel-2 p-[3px]">
      {items.map((v) => {
        const on = v.key === active;
        return (
          <Link
            key={v.key}
            href={v.href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-sm px-2.5 py-[5px] type-label ${on ? "border border-line bg-panel text-fg-1" : "border border-transparent text-fg-2 hover:text-fg-1"}`}
          >
            <Icon name={on ? v.activeIcon : v.icon} tone={on ? "text-fg-1" : "text-fg-3"} />
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}
