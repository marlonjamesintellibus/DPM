// DPM's answer to a question asked in the chat (machines doc, sections 15 and 17). Every fact comes from
// the asker's own data through the same per-viewer queries the screens use, so an answer shows nothing
// the asker could not open themselves (P10, QA3, QA5, MF12). The details are cards drawn from that data;
// the sentence over them is DPM's own here, and Atlas may reword it later (atlas/answer.ts).
import { inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import type { Answer, AnswerCard, AskedQuestion } from "../domain/question";
import { getInbox } from "./inbox";
import { clockTime, getProject, readableProjects, shortDate, todayIn, type ProjectView } from "./project";
import { getReview } from "./review";

type Body = Pick<Answer, "text" | "cards" | "more">;
const SHOWN = 8;
const CONFIDENCE = { high: "High", medium: "Medium", low: "Low" } as const;

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** MF11: at most 8 cards; past that, 7 and a count of the rest with where to find them. */
function capped(cards: AnswerCard[], where: { label: string; href: string }): Pick<Answer, "cards" | "more"> {
  if (cards.length <= SHOWN) return { cards, more: null };
  return { cards: cards.slice(0, SHOWN - 1), more: { label: `${cards.length - SHOWN + 1} more ${where.label}`, href: where.href } };
}

/** QA1: the asker's updates waiting for review, with each item that needs their OK, then their inbox, worst first. */
async function needsMe(conn: Conn, viewerId: string, now: Date): Promise<Body> {
  const waiting = (await conn.select().from(t.captures).where(inArray(t.captures.state, ["proposed", "reviewing"])))
    .filter((c) => c.authorId === viewerId)
    .sort((a, b) => a.messageAt.getTime() - b.messageAt.getTime());
  const cards: AnswerCard[] = [];
  const sentences: string[] = [];
  for (const c of waiting) {
    const review = await getReview(conn, viewerId, c.id);
    if (!review.found) continue;
    const needOk = review.groups.flatMap((g) => g.items.map((i) => ({ i, where: g.type === "project" ? g.name : g.label }))).filter(({ i }) => i.state === "needs_ok");
    const when = clockTime(c.messageAt);
    if (needOk.length) {
      sentences.push(`Your update from ${when} has ${counted(needOk.length, "item", "items")} waiting for your OK before it can be saved.`);
      for (const { i, where } of needOk) {
        cards.push({ title: i.title, detail: `${where}: ${i.change}`, tag: `Needs your OK · ${CONFIDENCE[i.confidence]} confidence`, href: `/review/${c.id}`, accept: { captureId: c.id, itemId: i.id } });
      }
    } else {
      sentences.push(`Your update from ${when} is ready to save.`);
      cards.push({ title: `Your update from ${when}`, detail: "Everything in it is ready; save it to update your projects", tag: "Ready to save", href: `/review/${c.id}` });
    }
  }
  const inbox = (await getInbox(conn, viewerId, now)).items.filter((i) => !(i.subject.type === "capture" && waiting.some((c) => c.id === i.subject.id)));
  for (const i of inbox) cards.push({ title: i.title, detail: `Why: ${i.why}`, tag: i.groupLabel, href: `/?view=inbox&item=${encodeURIComponent(i.id)}` });
  if (inbox.length) sentences.push(`${counted(inbox.length, "item is", "items are")} in your inbox.`);
  if (!cards.length) return { text: "Nothing needs you right now.", cards: [], more: null };
  return { text: sentences.join(" "), ...capped(cards, { label: "in your inbox", href: "/?view=inbox" }) };
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
  const cards: AnswerCard[] = [];
  for (const v of views) {
    for (const e of v.braid.entries.filter((x) => x.kind === "blocker" && x.onLog)) {
      const first = e.sources[0]?.at;
      cards.push({
        title: e.title,
        detail: `${v.project.name}: ${counted(e.reportCount, "report", "reports")}${first ? `, since ${shortDate(todayIn(first))}` : ""}`,
        tag: "Blocker",
        href: `/projects/${v.project.id}?view=table&log=blocker`,
      });
    }
    for (const w of [...v.threads.flatMap((th) => th.workItems), ...v.unthreaded.workItems].filter((x) => x.state === "blocked")) {
      cards.push({ title: `${w.number ? `${w.number} ` : ""}${w.title}`, detail: `${v.project.name}: Blocked${w.blockedNote ? `, ${w.blockedNote}` : ""}`, tag: "Blocked work", href: `/projects/${v.project.id}` });
    }
  }
  const scope = views.length === 1 && projectId ? views[0].project.name : "your projects";
  if (!cards.length) return { text: `Nothing is blocked on ${scope}.`, cards: [], more: null };
  return { text: `${counted(cards.length, "thing is", "things are")} blocked on ${scope}.`, ...capped(cards, { label: "on the BRAID logs", href: "/projects" }) };
}

async function standing(conn: Conn, viewerId: string, projectId: string | null, now: Date): Promise<Body> {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const cards = views.map((v): AnswerCard => {
    const set = v.displayed.from === "set" && v.setStatus ? `Set by ${v.setStatus.setBy?.name.split(" ")[0] ?? "its owner"}${v.reason ? `: ${v.reason.text}` : ""}; the plan says ${v.calculated.label}` : null;
    const waiting = v.setStatus?.waitingForReason ? `Set ${v.setStatus.label} with no reason yet; the plan says ${v.calculated.label}` : null;
    return { title: v.project.name, detail: set ?? waiting ?? `Worked out from the plan`, tag: v.displayed.label, href: `/projects/${v.project.id}` };
  });
  if (!cards.length) return { text: "You are not in any projects yet.", cards: [], more: null };
  if (cards.length === 1) return { text: `${cards[0].title} is ${cards[0].tag}.`, cards, more: null };
  return { text: `Here is how your ${cards.length} projects stand.`, cards, more: null };
}

/** DPM's answer to a checked question, as of now, in DPM's own words. */
export async function answerFor(conn: Conn, viewerId: string, question: AskedQuestion, now: Date): Promise<Answer> {
  const base = { topic: question.topic, wording: "rules" as const, asOf: now.toISOString() };
  switch (question.topic) {
    case "needs_me":
      return { ...base, ...(await needsMe(conn, viewerId, now)) };
    case "blocked":
      return { ...base, ...(await blocked(conn, viewerId, question.projectId, now)) };
    case "project_status":
      return { ...base, ...(await standing(conn, viewerId, question.projectId, now)) };
    case "unclear":
      return { ...base, text: "I'm not sure what you mean. Ask the whole question, for example: What's blocked on Forager?", cards: [], more: null };
    case "other": {
      const today = await needsMe(conn, viewerId, now);
      const lead = "I can't answer that yet. I can tell you what needs you, what is blocked, and how a project stands.";
      return { ...base, ...today, text: today.cards.length ? `${lead} Here is what needs you today.` : `${lead} Nothing needs you right now.` };
    }
  }
}
