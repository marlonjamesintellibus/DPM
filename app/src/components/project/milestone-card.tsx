// The project's milestones against their targets (Figma L14, "Milestone chart"): target, forecast and
// the status the rules give each one. A milestone forecast to miss its target is marked.
import { StatusMark } from "@/components/ui/controls";
import { shortDate, type ProjectView } from "@/queries/project";

export function MilestoneCard({ view }: { view: ProjectView }) {
  const milestones = [...view.threads.flatMap((t) => t.milestones), ...view.unthreaded.milestones].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  return (
    <section className="flex w-[520px] shrink-0 flex-col self-start overflow-hidden rounded-lg border border-line bg-panel">
      <h2 className="border-b border-line pt-3 pr-3.5 pb-2.5 pl-4 type-micro text-fg-3 uppercase">Milestone chart</h2>
      <h3 className="px-4 pt-3 pb-2.5 type-heading text-fg-1">Milestones</h3>
      <div className="grid grid-cols-[minmax(0,1fr)_76px_92px_104px] border-y border-line bg-panel-2 px-4 py-1.5">
        {["Milestone", "Target", "Forecast", "Status"].map((h) => (
          <span key={h} className="type-micro text-fg-3">
            {h}
          </span>
        ))}
      </div>
      {milestones.map((m) => {
        const late = m.forecastDate > m.targetDate && m.state !== "done";
        return (
          <div key={m.id} className={`grid grid-cols-[minmax(0,1fr)_76px_92px_104px] items-center border-b border-line px-4 py-2 last:border-b-0 ${late ? "bg-warn-soft" : ""}`}>
            <span className="truncate type-caption text-fg-1">{m.name}</span>
            <span className="type-caption text-fg-2">{shortDate(m.targetDate)}</span>
            <span className={`type-caption ${late ? "text-warn" : "text-fg-2"}`}>{m.state === "done" ? `Done ${shortDate(m.forecastDate)}` : shortDate(m.forecastDate)}</span>
            <StatusMark status={m.status} label={m.statusLabel} />
          </div>
        );
      })}
      {milestones.length === 0 && <p className="px-4 py-3 type-caption text-fg-3">No milestones yet.</p>}
    </section>
  );
}
