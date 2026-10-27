// Phase L, M30: what "Undo that" did, in DPM's own words (the undo job ran while the message was read; its
// id is in question.made). The Undo button says the same. A refusal names and links only records the asker
// can open now, and who changed them (UN2); after the window, it links the projects to change them from (UN1).
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Conn } from "../../db/conn";
import * as t from "../../db/schema";
import { config } from "../../domain/config";
import type { SavedRef } from "../../domain/machines/undo";
import type { AnswerCard } from "../../domain/question";
import { clockTime, firstName, projectReader } from "../project";
import { readReceipt, toldUndone } from "../undo";
import type { AnswerBuilder, Body } from "./shared";

const NOTHING: Body = { text: "There's nothing of yours to undo.", cards: [], more: null };

export const undo: AnswerBuilder = async (conn, viewerId, question, now) => undoReply(conn, viewerId, question.made?.[0] ?? null, now);

/** The reply for one undo job, or for none (UN4). Only the asker's own job is read. */
export async function undoReply(conn: Conn, viewerId: string, jobId: string | null, now: Date): Promise<Body> {
  if (!jobId) return NOTHING;
  const [job] = await conn.select().from(t.undos).where(and(eq(t.undos.id, jobId), eq(t.undos.ownerId, viewerId)));
  const receipt = job ? await readReceipt(conn, job.captureId) : null;
  if (!job || !receipt) return NOTHING;
  const reader = await projectReader(conn, viewerId);
  const saved = clockTime(receipt.savedAt);
  // UN5: asked again, it says what happened the first time
  const earlier = job.createdAt.getTime() < now.getTime();
  const projects = [...new Set(receipt.records.flatMap((r) => (r.projectId && reader.mayRead(r.projectId) ? [r.projectId] : [])))];
  const projectCards = await projectLinks(conn, projects);

  if (job.state === "undone") {
    const n = receipt.records.filter((r) => r.type !== "set_status" && r.type !== "handover").length;
    const what = `${n} ${n === 1 ? "change is" : "changes are"} back as ${n === 1 ? "it was" : "they were"}`;
    if (earlier) return { text: `You already undid your ${saved} update at ${clockTime(job.updatedAt)}.`, cards: projectCards, more: null };
    // Rule 2: only who was told; each can open the record, as the asker can, so naming them hints at nothing
    const told = await toldUndone(conn, job.id);
    const names = told.length ? (await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, told))).map((p) => firstName(p.name)).sort() : [];
    const tell = names.length ? ` I told ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]} it's undone.` : "";
    return { text: `Done. I undid your ${saved} update: ${what}.${tell}`, cards: projectCards, more: null };
  }
  const refusal = job.refusal;
  switch (refusal?.why) {
    case "too_late":
      return {
        text: `It's been more than ${config.undoMinutes} minutes since you saved that ${saved} update, so I can't undo it. You can change these from the project now.`,
        cards: projectCards,
        more: null,
      };
    case "moved": {
      const named = await movedCards(conn, viewerId, reader.mayRead, refusal.records, receipt.savedAt);
      return {
        text: named.length
          ? `Someone changed ${named.length === 1 ? "this" : "these"} since you saved it, so nothing was undone.`
          : "Something in it has changed since you saved it, so nothing was undone.",
        cards: named,
        more: null,
      };
    }
    case "no_right":
      return { text: "You're no longer in a project that update changed, so nothing was undone.", cards: [], more: null };
    default:
      return { text: "Something in it changed just as I tried, so nothing was undone. You can change these from the project now.", cards: projectCards, more: null };
  }
}

async function projectLinks(conn: Conn, ids: readonly string[]): Promise<AnswerCard[]> {
  const cards: AnswerCard[] = [];
  for (const id of [...ids].sort()) {
    const [p] = await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, id));
    if (p) cards.push({ title: p.name, detail: null, tag: "Project", href: `/projects/${id}` });
  }
  return cards;
}

const SUBJECT: Record<SavedRef["type"], string> = {
  work_item: "work_item",
  milestone: "milestone",
  handover_step: "handover_step",
  handover: "handover",
  braid_entry: "braid_entry",
  set_status: "project",
  leave: "leave",
};

/** UN2: each record that moved, on a project the asker can open now, with who moved it and when. */
async function movedCards(conn: Conn, viewerId: string, mayRead: (projectId: string) => boolean, refs: readonly SavedRef[], since: Date): Promise<AnswerCard[]> {
  const cards: AnswerCard[] = [];
  for (const ref of refs) {
    const named = await labelOf(conn, ref);
    if (!named || (named.projectId && !mayRead(named.projectId))) continue;
    const [last] = await conn
      .select({ actorId: t.auditEntries.actorId, at: t.auditEntries.at })
      .from(t.auditEntries)
      .where(and(eq(t.auditEntries.subjectType, SUBJECT[ref.type]), eq(t.auditEntries.subjectId, ref.id), eq(t.auditEntries.actorType, "person"), gt(t.auditEntries.at, since)))
      .orderBy(desc(t.auditEntries.at), desc(t.auditEntries.id))
      .limit(1);
    const [who] = last?.actorId ? await conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, last.actorId)) : [];
    const by = last?.actorId === viewerId ? "You" : who ? firstName(who.name) : null;
    cards.push({ title: named.title, detail: by && last ? `${by} changed it at ${clockTime(last.at)}` : "Changed since", tag: "Changed since", href: named.href });
  }
  return cards;
}

async function labelOf(conn: Conn, ref: SavedRef): Promise<{ title: string; projectId: string | null; href: string } | null> {
  switch (ref.type) {
    case "work_item": {
      const [w] = await conn.select().from(t.workItems).where(eq(t.workItems.id, ref.id));
      return w ? { title: `${w.number ? `${w.number} ` : ""}${w.title}`, projectId: w.projectId, href: `/projects/${w.projectId}` } : null;
    }
    case "milestone": {
      const [m] = await conn.select().from(t.milestones).where(eq(t.milestones.id, ref.id));
      return m ? { title: m.name, projectId: m.projectId, href: `/projects/${m.projectId}` } : null;
    }
    case "handover": {
      const [h] = await conn.select().from(t.handovers).where(eq(t.handovers.id, ref.id));
      return h ? { title: h.title, projectId: h.projectId, href: `/projects/${h.projectId}` } : null;
    }
    case "handover_step": {
      const [s] = await conn.select({ title: t.handoverSteps.title, projectId: t.handovers.projectId }).from(t.handoverSteps).innerJoin(t.handovers, eq(t.handovers.id, t.handoverSteps.handoverId)).where(eq(t.handoverSteps.id, ref.id));
      return s ? { title: `Handover: ${s.title}`, projectId: s.projectId, href: `/projects/${s.projectId}` } : null;
    }
    case "braid_entry": {
      const [e] = await conn.select().from(t.braidEntries).where(eq(t.braidEntries.id, ref.id));
      return e ? { title: e.title, projectId: e.projectId, href: `/projects/${e.projectId}?view=table` } : null;
    }
    case "set_status": {
      const [p] = await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, ref.id));
      return p ? { title: `${p.name}'s status`, projectId: ref.id, href: `/projects/${ref.id}` } : null;
    }
    case "leave":
      // Personal: the asker's own leave, never anyone else's
      return { title: "Your leave", projectId: null, href: "/?view=chat" };
  }
}
