// The BRAID log at a glance, on the project Dashboard (Figma L14d, section 13): one tile per kind with
// how many are live, the entry that needs someone first and where it stands, and a line on what
// changed (a risk that became an issue). Each tile opens the table filtered to that kind.
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { StateMark } from "@/components/ui/controls";
import type { ProjectView } from "@/queries/project";

export function BraidSummary({ view, tableHref }: { view: ProjectView; tableHref: string }) {
  const { summary, kindChangesAsked, waitingForApproval } = view.braid;
  const live = summary.reduce((n, t) => n + t.live, 0);
  const head = [`BRAID summary · ${live} live`, ...(waitingForApproval ? [`${waitingForApproval} waiting for approval`] : []), ...(kindChangesAsked ? [`${kindChangesAsked} kind ${kindChangesAsked === 1 ? "change" : "changes"} asked`] : [])].join(" · ");
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center border-b border-line pt-3 pr-3.5 pb-2.5 pl-4">
        <h2 className="flex-1 type-micro text-fg-3 uppercase">{head}</h2>
        <Link href={tableHref} aria-label="Open the BRAID log as a table" className="rounded-sm p-0.5 hover:bg-hover">
          <Icon name="table" />
        </Link>
      </div>
      <div className="flex flex-col gap-2.5 px-4 pt-2.5 pb-4">
        <h3 className="type-heading text-fg-1">Where the project stands, by kind</h3>
        <div className="grid grid-cols-2 gap-2.5">
          {summary.map((t) => (
            <Link
              key={t.kind}
              href={`${tableHref}&log=${t.kind}`}
              className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-panel p-3 hover:border-line-strong hover:bg-hover"
            >
              <span className="flex items-center gap-2">
                <span className="flex-1 type-micro text-fg-3 uppercase">{t.label}</span>
                <span className="type-heading text-fg-1">{t.live}</span>
              </span>
              {t.entry ? (
                <>
                  <span className="type-caption text-fg-1">{t.entry.title}</span>
                  <StateMark waiting={t.entry.waiting} label={t.entry.stateLabel} />
                </>
              ) : null}
              <span className="type-micro text-fg-3">{t.note}</span>
            </Link>
          ))}
        </div>
        <p className="type-caption text-fg-3">The table icon opens the full log, where kinds are switched and approved.</p>
      </div>
    </section>
  );
}
