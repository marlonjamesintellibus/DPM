// What is blocked (section 15; section 17 for the cards): live blockers on the BRAID logs and blocked
// work, on the project asked about or on all of the asker's.
import { shortDate, todayIn } from "../project";
import { capped, counted, projectsAsked, type AnswerBuilder, type DraftCard } from "./shared";

export const blocked: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const cards: DraftCard[] = [];
  for (const v of views) {
    for (const e of v.braid.entries.filter((x) => x.kind === "blocker" && x.onLog)) {
      const first = e.sources[0]?.at;
      cards.push({
        title: e.title,
        detail: `${v.project.name}: ${counted(e.reportCount, "report", "reports")}${first ? `, since ${shortDate(todayIn(first))}` : ""}`,
        tag: "Blocker",
        href: `/projects/${v.project.id}?view=table&log=blocker`,
        subject: { type: "braid_entry", id: e.id, projectId: v.project.id },
        offer: ["resolve"],
      });
    }
    for (const w of [...v.threads.flatMap((th) => th.workItems), ...v.unthreaded.workItems].filter((x) => x.state === "blocked")) {
      cards.push({
        title: `${w.number ? `${w.number} ` : ""}${w.title}`,
        detail: `${v.project.name}: Blocked${w.blockedNote ? `, ${w.blockedNote}` : ""}`,
        tag: "Blocked work",
        href: `/projects/${v.project.id}`,
        subject: { type: "work_item", id: w.id, projectId: v.project.id },
        offer: ["unblock"],
      });
    }
  }
  const scope = views.length === 1 && projectId ? views[0].project.name : "your projects";
  if (!cards.length) return { text: `Nothing is blocked on ${scope}.`, cards: [], more: null };
  return { text: `${counted(cards.length, "thing is", "things are")} blocked on ${scope}.`, ...capped(cards, { label: "on the BRAID logs", href: "/projects" }) };
};
