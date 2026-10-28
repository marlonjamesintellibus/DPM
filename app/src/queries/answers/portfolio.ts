// How every project in the asker's view stands (conversational plan, phase N), worst first: Off track,
// At risk, then the rest, each with its displayed status and, when one is set, who set it and why.
// The view is the projects they read (P10). An executive's or delivery lead's org lens (KB A7.2) would
// widen it, but DPM has no lens tags yet and visibility follows group membership (F16), so every lens is
// their own projects for now: LD4 (an executive with no tags) and LD7 (an employee) hold as built.
import type { Status } from "../../domain/status/status";
import type { ProjectView } from "../project";
import { statusCard } from "./project-status";
import { capped, projectsAsked, type AnswerBuilder } from "./shared";

// Worst first; a project with no target yet goes last
const WORST: readonly Status[] = ["off_track", "at_risk", "not_started", "on_track", "done"];
const rank = (s: Status | null) => (s ? WORST.indexOf(s) : WORST.length);

/** One project in a sentence, in plain words: "Store Insights is On track.", "GQ & Academy has no target yet." */
function standsAs(v: ProjectView): string {
  if (!v.displayed.status) return `${v.project.name} has no target yet.`;
  if (v.displayed.status === "not_started") return `${v.project.name} has not started yet.`;
  return `${v.project.name} is ${v.displayed.label}.`;
}

export const portfolio: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = (await projectsAsked(conn, viewerId, projectId, now)).sort((a, b) => rank(a.displayed.status) - rank(b.displayed.status) || a.project.name.localeCompare(b.project.name));
  if (!views.length) return { text: "You are not in any projects yet.", cards: [], more: null };
  const count = (s: Status) => views.filter((v) => v.displayed.status === s).length;
  const [off, risk] = [count("off_track"), count("at_risk")];
  const said = [off ? `${off} ${off === 1 ? "is" : "are"} Off track` : null, risk ? `${risk} ${risk === 1 ? "is" : "are"} At risk` : null].filter(Boolean).join(" and ");
  const text =
    views.length === 1
      ? standsAs(views[0])
      : said
        ? `Of your ${views.length} projects, ${said}. They are listed worst first.`
        : `None of your ${views.length} projects is Off track or At risk.`;
  return { text, ...capped(views.map(statusCard), { label: "of your projects", href: "/projects" }) };
};
