// The plan as a timeline (L14 "Plan"): each thread with its status, each piece of work as a bar
// from its start to its due date, coloured by what the rules say about it, today as a line, and
// releases (client-visible milestones) as lines. Positions come from dates only.
import { StatusMark } from "@/components/ui/controls";
import { addDays, daysBetween, type IsoDate } from "@/domain/dates";
import { shortDate, type ProjectView, type ProjectWorkItem } from "@/queries/project";

const LABEL_W = 250;
const CHART_W = 850;
const ROW = 30;

function barTone(w: ProjectWorkItem, today: IsoDate): string {
  if (w.state === "done") return "bg-ok";
  if (w.state === "blocked" || (w.state === "to_do" && w.startDate && daysBetween(w.startDate, today) > 0)) return "bg-bad";
  if (w.state === "to_do") return "bg-line-strong";
  if (w.status === "at_risk" || w.status === "off_track") return "bg-accent outline-2 outline-warn outline-solid -outline-offset-2";
  return "bg-accent";
}

// The Monday on or before a day: the ticks fall on Mondays, as the design's do
function mondayOf(day: IsoDate): IsoDate {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export function PlanCard({ view, today }: { view: ProjectView; today: IsoDate }) {
  const work = [...view.threads.flatMap((t) => t.workItems), ...view.unthreaded.workItems];
  const milestones = [...view.threads.flatMap((t) => t.milestones), ...view.unthreaded.milestones];
  const days = [...work.flatMap((w) => [w.startDate, w.dueDate]), ...milestones.map((m) => m.forecastDate), today].filter((d): d is IsoDate => !!d).sort();
  const start = mondayOf(days[0] ?? today);
  const end = addDays(days.at(-1) ?? today, 3);
  const span = Math.max(1, daysBetween(start, end));
  const x = (d: IsoDate) => LABEL_W + (daysBetween(start, d) / span) * CHART_W;
  const ticks: IsoDate[] = [];
  for (let d = start; daysBetween(d, end) >= 0; d = addDays(d, 7)) ticks.push(d);
  const releases = milestones.filter((m) => m.clientVisible);

  const rows: ({ type: "thread"; name: string; description: string | null; status: ProjectView["calculated"]["status"]; label: string } | { type: "work"; w: ProjectWorkItem })[] = [];
  for (const t of view.threads) {
    rows.push({ type: "thread", name: t.name, description: t.description, status: t.status, label: t.statusLabel });
    for (const w of t.workItems) rows.push({ type: "work", w });
  }
  for (const w of view.unthreaded.workItems) rows.push({ type: "work", w });
  const height = 32 + rows.length * ROW + 24;
  const worst = view.threads.filter((t) => t.status === view.calculated.status).map((t) => t.name)[0];

  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-panel">
      <h2 className="border-b border-line pt-3 pr-3.5 pb-2.5 pl-4 type-micro text-fg-3 uppercase">Plan</h2>
      <div className="flex flex-col gap-3 px-4 pt-3.5 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="type-heading text-fg-1">{view.project.name}</span>
          <span className="type-body text-fg-2">{view.project.customer ?? "Internal"}</span>
          <div className="flex-1" />
          <StatusMark status={view.calculated.status} label={view.calculated.label} />
          {worst && <span className="type-caption text-fg-3">worst thread: {worst}</span>}
        </div>
        <div className="relative overflow-x-auto" style={{ height }}>
          <div className="relative" style={{ width: LABEL_W + CHART_W + 10, height }}>
            {ticks.map((d) => (
              <span key={d} className="absolute top-1 type-micro text-fg-3" style={{ left: x(d) }}>
                {shortDate(d)}
              </span>
            ))}
            <div className="absolute h-px bg-line" style={{ left: LABEL_W, top: 24, width: CHART_W }} />
            {rows.map((r, i) => {
              const top = 32 + i * ROW;
              if (r.type === "thread")
                return (
                  <div key={`t${i}`} className="absolute flex items-center gap-2" style={{ top, left: 0, width: LABEL_W + CHART_W }}>
                    <span className="w-[250px] shrink-0 type-body-medium text-fg-1">{r.name}</span>
                    <StatusMark status={r.status} label={r.label} />
                    {r.description && <span className="type-caption text-fg-3">{r.description}</span>}
                  </div>
                );
              const w = r.w;
              const from = w.startDate ?? w.dueDate;
              return (
                <div key={w.id}>
                  <span className="absolute type-caption text-fg-2" style={{ top: top + 1, left: 16 }}>
                    {w.title}
                  </span>
                  {from && w.dueDate && (
                    <div
                      title={`${w.number ?? ""} ${w.title}: ${w.stateLabel}${w.blockedNote ? `, ${w.blockedNote}` : ""} · due ${shortDate(w.dueDate)}`}
                      className={`absolute h-3.5 rounded-[4px] ${barTone(w, today)}`}
                      style={{ top: top + 3, left: x(from), width: Math.max(8, x(w.dueDate) - x(from)) }}
                    />
                  )}
                </div>
              );
            })}
            <div className="absolute w-0.5 bg-inverse" style={{ left: x(today), top: 24, height: height - 44 }} />
            <span className="absolute type-micro text-fg-1" style={{ left: x(today) + 4, top: height - 18 }}>
              Today
            </span>
            {releases.map((m) => (
              <div key={m.id}>
                <div className="absolute w-px bg-accent" style={{ left: x(m.forecastDate), top: 24, height: height - 44 }} />
                <span className="absolute -translate-x-full pr-1 type-micro whitespace-nowrap text-accent" style={{ left: x(m.forecastDate), top: height - 18 }}>
                  {m.name.split(" · ").at(-1)} · {shortDate(m.forecastDate)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          {[
            ["bg-ok", "Done"],
            ["bg-accent", "In progress"],
            ["bg-line-strong", "Not started"],
            ["bg-bad", "Blocked or late to start"],
            ["bg-accent outline-2 outline-warn outline-solid -outline-offset-2", "Forecast to miss its date"],
          ].map(([tone, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`h-2 w-3.5 rounded-[3px] ${tone}`} />
              <span className="type-caption text-fg-2">{label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
