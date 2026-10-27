// DPM's answer to a question asked in the chat (machines doc, section 15). Every fact comes from the
// asker's own data through the same per-viewer queries the screens use, so an answer shows nothing the
// asker could not open themselves (P10, QA3, QA5). Atlas only said what was asked.
import { inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { loadItems } from "../db/records";
import * as t from "../db/schema";
import { saveBlockers } from "../domain/machines/capture";
import type { Answer, AskedQuestion } from "../domain/question";
import { getInbox } from "./inbox";
import { clockTime, getProject, readableProjects, type ProjectView } from "./project";

type Body = Omit<Answer, "asOf">;
const SHOWN = 6;

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** At most SHOWN lines; the rest are counted, with where to find them. */
function capped(lines: Answer["lines"], more: { label: string; href: string }): Answer["lines"] {
  if (lines.length <= SHOWN) return lines;
  return [...lines.slice(0, SHOWN - 1), { label: `${lines.length - SHOWN + 1} more ${more.label}`, href: more.href }];
}

/** QA1: the asker's updates waiting for review, then their inbox items, worst first. */
async function needsMe(conn: Conn, viewerId: string, now: Date): Promise<Body> {
  const waiting = await conn.select().from(t.captures).where(inArray(t.captures.state, ["proposed", "reviewing"]));
  const reviews: Answer["lines"] = [];
  for (const c of waiting.filter((x) => x.authorId === viewerId).sort((a, b) => a.messageAt.getTime() - b.messageAt.getTime())) {
    const { needsOk } = saveBlockers((await loadItems(conn, c.id)).items);
    reviews.push({ label: `Your update from ${clockTime(c.messageAt)} is waiting for review${needsOk ? `: ${needsOk} ${needsOk === 1 ? "needs" : "need"} your OK` : ""}`, href: `/review/${c.id}` });
  }
  const inbox = await getInbox(conn, viewerId, now);
  // An update already listed is not listed again as its inbox reminder
  const items = inbox.items
    .filter((i) => !(i.subject.type === "capture" && waiting.some((c) => c.id === i.subject.id)))
    .map((i) => ({ label: i.title, href: `/?view=inbox&item=${encodeURIComponent(i.id)}` }));
  const lines = [...reviews, ...items];
  if (!lines.length) return { text: "Nothing needs you right now.", lines: [] };
  return { text: `${counted(lines.length, "thing needs", "things need")} you:`, lines: capped(lines, { label: "in your inbox", href: "/?view=inbox" }) };
}

/** The projects a question is about: the one it names if the asker is in it, otherwise all of theirs. */
async function projectsAsked(conn: Conn, viewerId: string, projectId: string | null, now: Date): Promise<ProjectView[]> {
  const readable = await readableProjects(conn, viewerId);
  const ids = projectId && readable.includes(projectId) ? [projectId] : readable;
  const views: ProjectView[] = [];
  for (const id of [...ids].sort()) {
    const v = await getProject(conn, viewerId, id, now);
    if (v.found) views.push(v);
  }
  return views;
}

async function blocked(conn: Conn, viewerId: string, projectId: string | null, now: Date): Promise<Body> {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const lines: Answer["lines"] = [];
  for (const v of views) {
    for (const e of v.braid.entries.filter((x) => x.kind === "blocker" && x.onLog)) {
      lines.push({ label: `${v.project.name}: ${e.title} (${counted(e.reportCount, "report", "reports")})`, href: `/projects/${v.project.id}?view=table&log=blocker` });
    }
    const work = [...v.threads.flatMap((th) => th.workItems), ...v.unthreaded.workItems].filter((w) => w.state === "blocked");
    for (const w of work) lines.push({ label: `${v.project.name}: ${w.number ? `${w.number} ` : ""}${w.title} is Blocked${w.blockedNote ? `, ${w.blockedNote}` : ""}`, href: `/projects/${v.project.id}` });
  }
  const scope = views.length === 1 && projectId ? views[0].project.name : "your projects";
  if (!lines.length) return { text: `Nothing is blocked on ${scope}.`, lines: [] };
  return { text: `${counted(lines.length, "thing is", "things are")} blocked on ${scope}:`, lines: capped(lines, { label: "on the BRAID logs", href: "/projects" }) };
}

async function standing(conn: Conn, viewerId: string, projectId: string | null, now: Date): Promise<Body> {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const lines = views.map((v) => {
    const set = v.displayed.from === "set" && v.setStatus ? `, set by ${v.setStatus.setBy?.name.split(" ")[0] ?? "its owner"}${v.reason ? ` because ${v.reason.text.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` : ""}; the plan says ${v.calculated.label}` : "";
    const waiting = v.setStatus?.waitingForReason ? `; set ${v.setStatus.label} with no reason yet` : "";
    return { label: `${v.project.name} is ${v.displayed.label}${set}${waiting}`, href: `/projects/${v.project.id}` };
  });
  if (!lines.length) return { text: "You are not in any projects yet.", lines: [] };
  if (lines.length === 1) return { text: `${lines[0].label}.`, lines };
  return { text: "How your projects stand:", lines };
}

/** DPM's answer to a checked question, as of now. */
export async function answerFor(conn: Conn, viewerId: string, question: AskedQuestion, now: Date): Promise<Answer> {
  const asOf = now.toISOString();
  switch (question.topic) {
    case "needs_me":
      return { ...(await needsMe(conn, viewerId, now)), asOf };
    case "blocked":
      return { ...(await blocked(conn, viewerId, question.projectId, now)), asOf };
    case "project_status":
      return { ...(await standing(conn, viewerId, question.projectId, now)), asOf };
    case "unclear":
      return { text: "I'm not sure what you mean. Ask the whole question, for example: What's blocked on Forager?", lines: [], asOf };
    case "other": {
      const fallback = await needsMe(conn, viewerId, now);
      const today = fallback.lines.length ? ` Here is what needs you today: ${fallback.text.replace(/:$/, ".")}` : " Nothing needs you right now.";
      return { text: `I can't answer that yet. I can tell you what needs you, what is blocked, and how a project stands.${today}`, lines: fallback.lines, asOf };
    }
  }
}
