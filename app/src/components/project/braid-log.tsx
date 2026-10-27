// The project's BRAID log (L14b): every kind on one list, filters by kind and by "waiting for
// approval", the reports behind each entry, who raised it, and where it stands. Opening a row shows
// its sources (only the quotes routed to this project, rule 9) and, for a PM or Lead, the decision.
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { DecideControls } from "@/components/inbox/inbox-actions";
import { StateMark } from "@/components/ui/controls";
import type { BraidKind } from "@/domain/rights";
import { daysAgo, KIND_LABEL, shortDate, type ProjectBraidEntry, type ProjectView } from "@/queries/project";

const PLURAL: Record<BraidKind, string> = { blocker: "Blockers", risk: "Risks", assumption: "Assumptions", issue: "Issues", dependency: "Dependencies", decision: "Decisions" };
const ORDER: readonly BraidKind[] = ["blocker", "risk", "dependency", "assumption", "issue", "decision"];

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function subline(e: ProjectBraidEntry, at: Date): string {
  if (e.waitingForApproval) {
    const s = e.sources[0];
    return s ? `From ${s.person.name.split(" ")[0]}'s ${s.fromCapture ? "update" : "report"}, ${daysAgo(s.at, at)}` : "Waiting for a PM or Lead";
  }
  if (e.resolvedOn) return `Resolved ${shortDate(e.resolvedOn)}${e.resolvedBy ? ` by ${e.resolvedBy.name.split(" ")[0]}` : ""}`;
  const parts = e.links.map((l) => `${l.relation === "related" ? "related to" : l.relation.replace("_", " ")} ${KIND_LABEL[l.kind].toLowerCase()} ${l.title}`);
  if (e.decidedOn) parts.push(`${e.selfApproved ? "approved by its reporter" : "approved"} ${shortDate(e.decidedOn)}`);
  return parts.join(" · ") || `Owner ${e.owner?.name ?? "not set"}`;
}

export function BraidLog({ view, filter, at, basePath }: { view: ProjectView; filter: string | undefined; at: Date; basePath: string }) {
  const { entries, counts, waitingForApproval } = view.braid;
  const shown = entries
    .filter((e) => (filter === "waiting" ? e.waitingForApproval : filter ? e.kind === filter : true))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const canDecide = view.viewerRole === "pm" || view.viewerRole === "lead";
  const chips: { key: string | undefined; label: string }[] = [
    { key: undefined, label: `All ${entries.length}` },
    ...ORDER.filter((k) => counts[k]).map((k) => ({ key: k, label: `${PLURAL[k]} ${counts[k]}` })),
    ...(waitingForApproval ? [{ key: "waiting", label: `Waiting for approval ${waitingForApproval}` }] : []),
  ];
  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center border-b border-line pt-3 pr-3.5 pb-2.5 pl-4">
        <h2 className="flex-1 type-micro text-fg-3 uppercase">
          BRAID log · {entries.length} {entries.length === 1 ? "entry" : "entries"}
          {waitingForApproval ? ` · ${waitingForApproval} waiting for approval` : ""}
        </h2>
        <Icon name="table" />
      </div>
      <div className="flex flex-col pt-1.5 pb-2">
        <h3 className="px-4 pt-1.5 pb-2 type-heading text-fg-1">Blockers, risks, assumptions, issues, dependencies, decisions</h3>
        <nav aria-label="Filter the log" className="flex flex-wrap gap-1.5 px-4 pb-2.5">
          {chips.map((c) => (
            <Link
              key={c.label}
              href={c.key ? `${basePath}?log=${c.key}` : basePath}
              scroll={false}
              aria-current={c.key === filter ? "true" : undefined}
              className={`rounded-sm px-2 py-[3px] type-caption ${c.key === filter ? "bg-panel-2 text-fg-1" : "text-fg-2 hover:bg-hover"}`}
            >
              {c.label}
            </Link>
          ))}
        </nav>
        {shown.length === 0 && <p className="border-t border-line px-4 py-3 type-caption text-fg-3">Nothing here.</p>}
        {shown.map((e) => (
          <details key={e.id} className="group border-t border-line">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-[9px] hover:bg-hover">
              <span className="w-24 shrink-0 type-caption text-fg-3">{e.kindLabel}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="type-body text-fg-1">{e.title}</span>
                <span className="type-caption text-fg-3">{subline(e, at)}</span>
              </span>
              <span className="w-20 shrink-0 type-caption text-fg-3">
                {e.reportCount} {e.kind === "risk" ? (e.reportCount === 1 ? "source" : "sources") : e.reportCount === 1 ? "report" : "reports"}
              </span>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 type-micro text-fg-2" title={e.reportedBy?.name}>
                {e.reportedBy ? initials(e.reportedBy.name) : "?"}
              </span>
              <span className="w-[170px] shrink-0">
                <StateMark waiting={e.waitingForApproval} label={e.waitingForApproval ? "Waiting for PM or Lead" : e.stateLabel} />
              </span>
            </summary>
            <div className="flex flex-col gap-3 bg-panel-2 px-4 py-3 pl-[124px]">
              {e.sources.map((s) => (
                <div key={s.id} className="flex flex-col gap-0.5 border-l-2 border-line-strong pl-3">
                  <span className="type-micro text-fg-3">
                    {s.person.name} · {s.ago}
                    {s.fromCapture ? " · from an update" : ""}
                  </span>
                  <span className="type-body text-fg-1">{s.quote ? `"${s.quote}"` : "No quote shown here: the words were not routed to this project."}</span>
                </div>
              ))}
              {e.waitingForApproval && canDecide && <DecideControls entryId={e.id} reporter={e.reportedBy?.name.split(" ")[0] ?? "the reporter"} related={e.links.map((l) => `${KIND_LABEL[l.kind]} · ${l.title}`)} />}
            </div>
          </details>
        ))}
        <p className="border-t border-line px-4 pt-2.5 pb-1 type-caption text-fg-3">
          Repeats from chats and meetings join one entry and keep every source. Kinds never merge with each other.
        </p>
      </div>
    </section>
  );
}
