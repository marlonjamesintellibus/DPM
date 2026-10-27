// The project's BRAID log as a table (Figma L14c, the project's Table view; section 13). A panel of
// filters by kind, waiting for approval and kind change asked; one row per entry with its kind, title,
// owner, reports, state and last change. The Kind cell changes the kind for a PM or Lead and asks for
// a member; a switched entry says what it was and why. Opening a row shows its sources (only the
// quotes routed to this project, rule 9) and, for a PM or Lead, the decision on a proposal.
import Link from "next/link";
import { DecideControls } from "@/components/inbox/inbox-actions";
import { StateMark } from "@/components/ui/controls";
import { switchEnd } from "@/domain/machines/braid-entry";
import { BRAID_KINDS, type BraidKind } from "@/domain/rights";
import { withArticle } from "@/domain/shared";
import {
  KIND_LABEL,
  KIND_PLURAL,
  shortDate,
  type ProjectBraidEntry,
  type ProjectView,
} from "@/queries/project";
import { KindMenu, type KindOption } from "./kind-menu";
import { KindRequestControls } from "./kind-request-controls";

const ORDER: readonly BraidKind[] = [
  "blocker",
  "risk",
  "dependency",
  "assumption",
  "issue",
  "decision",
];
const COLUMNS =
  "grid grid-cols-[128px_minmax(0,1fr)_112px_72px_176px_72px] gap-x-0 px-1.5";

const HINT: Record<BraidKind, string> = {
  blocker: "stopping work now",
  issue: "a problem to fix",
  risk: "might happen",
  assumption: "taken as true for now",
  dependency: "waits on another team",
  decision: "someone chose this",
};
const ENDS_AS: Record<string, string> = {
  realised: "Realised",
  broken: "Broken",
  late: "Late",
  switched: "Changed",
};
const lower = (k: BraidKind) => KIND_LABEL[k].toLowerCase();

/** The kinds an entry can become, each saying what happens to the entry it is now. */
function kindOptions(e: ProjectBraidEntry): KindOption[] {
  return BRAID_KINDS.filter((k) => k !== e.kind).map((to) => {
    const back = e.was === to;
    const end = switchEnd(e.kind, to, e.state);
    const closes = back
      ? `The ${lower(to)} it was reopens, with every report.`
      : `The ${lower(e.kind)} closes as ${ENDS_AS[end]} and links to the new ${lower(to)}, which keeps the reports.${to === "decision" ? " The decision waits for its approvers." : ""}`;
    return { kind: to, label: KIND_LABEL[to], hint: HINT[to], closes };
  });
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function subline(e: ProjectBraidEntry): string {
  if (e.switchNote) {
    const n = e.switchNote;
    const by = n.by?.name.split(" ")[0] ?? "Someone";
    const asked = n.askedBy ? `, as ${n.askedBy.name.split(" ")[0]} asked` : "";
    return `${by} switched this from ${KIND_LABEL[n.from]} to ${KIND_LABEL[n.to]}, ${shortDate(n.on)}${asked}: "${n.why}"`;
  }
  if (e.waitingForApproval) {
    const s = e.sources[0];
    return s
      ? `From ${s.person.name.split(" ")[0]}'s ${s.fromCapture ? "update" : "report"}, ${s.ago}`
      : "Waiting for a PM or Lead";
  }
  if (e.resolvedOn)
    return `Resolved ${shortDate(e.resolvedOn)}${e.resolvedBy ? ` by ${e.resolvedBy.name.split(" ")[0]}` : ""}`;
  const parts = e.links.map(
    (l) =>
      `${l.relation === "related" ? "related to" : l.relation.replace("_", " ")} ${KIND_LABEL[l.kind].toLowerCase()} ${l.title}`,
  );
  if (e.fixedNote) parts.push(e.fixedNote);
  else if (e.decidedOn)
    parts.push(
      `${e.selfApproved ? "approved by its reporter" : "approved"} ${shortDate(e.decidedOn)}`,
    );
  return parts.join(" · ") || `Owner ${e.owner?.name ?? "not set"}`;
}

// P11: an empty log or filter says what would put something there
function emptyLine(filter: string | undefined, total: number): string {
  if (!total)
    return "Nothing on this log yet. Blockers and issues go on when someone reports them; risks, assumptions, dependencies and decisions wait for a PM or Lead.";
  if (filter === "waiting") return "Nothing is waiting for approval.";
  if (filter === "asked") return "Nobody has asked to change a kind.";
  if (filter && filter in KIND_PLURAL)
    return `No ${KIND_PLURAL[filter as BraidKind].toLowerCase()} on this log.`;
  return "Nothing here.";
}

export function BraidTable({
  view,
  filter,
  basePath,
}: {
  view: ProjectView;
  filter: string | undefined;
  basePath: string;
}) {
  const {
    entries,
    counts,
    waitingForApproval,
    kindChangesAsked,
    switchedThisWeek,
  } = view.braid;
  const shown = entries
    .filter((e) =>
      filter === "waiting"
        ? e.waitingForApproval
        : filter === "asked"
          ? !!e.request
          : filter
            ? e.kind === filter
            : true,
    )
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const canDecide = view.viewerRole === "pm" || view.viewerRole === "lead";
  const live = entries.filter((e) => e.onLog).length;
  const href = (key: string | undefined) =>
    key ? `${basePath}&log=${key}` : basePath;
  const filters: { key: string | undefined; label: string; count: number }[] = [
    { key: undefined, label: "All", count: entries.length },
    ...ORDER.map((k) => ({ key: k, label: KIND_PLURAL[k], count: counts[k] })),
  ];
  const asks: { key: string; label: string; count: number }[] = [
    {
      key: "waiting",
      label: "Waiting for approval",
      count: waitingForApproval,
    },
    { key: "asked", label: "Kind change asked", count: kindChangesAsked },
  ];
  const FilterLink = ({
    f,
  }: {
    f: { key: string | undefined; label: string; count: number };
  }) => (
    <Link
      href={href(f.key)}
      scroll={false}
      aria-current={f.key === filter ? "true" : undefined}
      className={`flex items-center gap-2 rounded-sm px-2 py-[7px] ${f.key === filter ? "bg-accent-soft" : "hover:bg-hover"}`}
    >
      <span className="min-w-0 flex-1 type-caption text-fg-1">{f.label}</span>
      <span className="type-caption text-fg-2">{f.count}</span>
    </Link>
  );

  return (
    <section className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel">
      <nav
        aria-label="Filter the log"
        className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-line px-3 py-3.5"
      >
        <span className="type-label text-fg-1">BRAID log</span>
        <span className="pb-1.5 type-caption text-fg-3">
          Six kinds, one log. Click to filter.
        </span>
        {filters.map((f) => (
          <FilterLink key={f.label} f={f} />
        ))}
        <span className="my-1 h-px bg-line" aria-hidden />
        {asks.map((f) => (
          <FilterLink key={f.label} f={f} />
        ))}
        {switchedThisWeek > 0 && (
          <span className="px-2 pt-2.5 type-caption text-fg-3">
            {switchedThisWeek} {switchedThisWeek === 1 ? "entry" : "entries"}{" "}
            changed kind this week
          </span>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col overflow-x-auto">
        <div className="flex min-h-full min-w-[760px] flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
            <h2 className="type-heading text-fg-1">
              Blockers, risks, assumptions, issues, dependencies, decisions
            </h2>
            <span className="type-caption text-fg-3">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
              {live} live
            </span>
          </div>
          <div
            role="row"
            className={`${COLUMNS} border-b border-line bg-panel-2`}
          >
            {["Kind", "Title", "Owner", "Reports", "State", "Updated"].map(
              (h) => (
                <span
                  key={h}
                  role="columnheader"
                  className="px-2 py-2 type-micro text-fg-3"
                >
                  {h}
                </span>
              ),
            )}
          </div>
          <div role="rowgroup" className="flex flex-col overflow-auto">
            {shown.length === 0 && (
              <p className="px-4 py-3 type-caption text-fg-3">
                {emptyLine(filter, entries.length)}
              </p>
            )}
            {shown.map((e) => (
              <details key={e.id} className="group border-b border-line">
                <summary
                  className={`${COLUMNS} cursor-pointer list-none items-start py-0 ${e.request ? "bg-accent-soft" : "hover:bg-hover"}`}
                >
                  <span className="flex flex-col items-start gap-1 px-2 py-2.5">
                    {e.kindControl === "switch" || e.kindControl === "ask" ? (
                      <KindMenu
                        entryId={e.id}
                        version={e.version}
                        title={e.title}
                        kindLabel={e.kindLabel}
                        mode={e.kindControl}
                        options={kindOptions(e)}
                      />
                    ) : (
                      <span
                        className={`type-caption ${e.kindControl === "asked" ? "text-fg-1" : "text-fg-3"}`}
                      >
                        {e.kindLabel}
                      </span>
                    )}
                    {e.was && (
                      <span className="rounded-[4px] bg-panel-2 px-1.5 type-micro text-fg-2">
                        Was {withArticle(lower(e.was))}
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 px-2 py-2.5">
                    <span className="type-caption text-fg-1">{e.title}</span>
                    <span className="type-micro text-fg-3">{subline(e)}</span>
                    {e.request && (
                      <span className="flex flex-col gap-1.5 pt-1">
                        <span className="type-micro text-fg-2">
                          {e.request.mine
                            ? "You"
                            : (e.request.askedBy?.name.split(" ")[0] ??
                              "Someone")}{" "}
                          asked to switch this to{" "}
                          {withArticle(lower(e.request.toKind))}: &ldquo;
                          {e.request.why}&rdquo;
                        </span>
                        {e.kindControl === "switch" && (
                          <KindRequestControls
                            requestId={e.request.id}
                            version={e.request.version}
                            toLabel={KIND_LABEL[e.request.toKind]}
                            mode="answer"
                          />
                        )}
                        {e.kindControl === "asked" && e.request.mine && (
                          <KindRequestControls
                            requestId={e.request.id}
                            version={e.request.version}
                            toLabel={KIND_LABEL[e.request.toKind]}
                            mode="withdraw"
                          />
                        )}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 px-2 py-2.5">
                    {e.owner && (
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 type-micro text-fg-2"
                        aria-hidden
                      >
                        {initials(e.owner.name)}
                      </span>
                    )}
                    <span className="truncate type-caption text-fg-2">
                      {e.owner?.name.split(" ")[0] ?? "Not set"}
                    </span>
                  </span>
                  <span className="px-2 py-2.5 type-caption text-fg-2">
                    {e.reportCount}
                  </span>
                  <span className="px-2 py-2.5">
                    <StateMark
                      waiting={e.waitingForApproval || !!e.request}
                      label={
                        e.waitingForApproval
                          ? "Waiting for PM or Lead"
                          : e.request
                            ? "Kind change asked"
                            : e.stateLabel
                      }
                    />
                  </span>
                  <span className="px-2 py-2.5 type-caption text-fg-2">
                    {shortDate(e.updatedOn)}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 bg-panel-2 px-4 py-3 pl-[136px]">
                  {e.sources.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-col gap-0.5 border-l-2 border-line-strong pl-3"
                    >
                      <span className="type-micro text-fg-3">
                        {s.person.name} · {s.ago}
                        {s.fromCapture ? " · from an update" : ""}
                      </span>
                      <span className="type-body text-fg-1">
                        {s.quote
                          ? `"${s.quote}"`
                          : "No quote shown here: the words were not routed to this project."}
                      </span>
                    </div>
                  ))}
                  {e.waitingForApproval && canDecide && (
                    <DecideControls
                      entryId={e.id}
                      reporter={
                        e.reportedBy?.name.split(" ")[0] ?? "the reporter"
                      }
                      related={e.links.map(
                        (l) => `${KIND_LABEL[l.kind]} · ${l.title}`,
                      )}
                    />
                  )}
                </div>
              </details>
            ))}
          </div>
          <div className="mt-auto flex gap-4 border-t border-line bg-panel-2 px-3.5 py-2">
            {[
              `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
              `${kindChangesAsked} kind ${kindChangesAsked === 1 ? "change" : "changes"} asked`,
              `${switchedThisWeek} switched this week`,
              `${waitingForApproval} waiting for approval`,
            ].map((s) => (
              <span key={s} className="type-caption text-fg-3">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
