// What needs the asker (section 15, QA1, QA9; section 17 for the cards and Accept).
import { inArray } from "drizzle-orm";
import type { Conn } from "../../db/conn";
import * as t from "../../db/schema";
import type { CommandAct, CommandSubject } from "../../domain/machines/chat-command";
import { getInbox, type InboxCause, type InboxSubject } from "../inbox";
import { clockTime } from "../project";
import { getReview } from "../review";
import { capped, counted, type AnswerBuilder, type DraftCard } from "./shared";

const CONFIDENCE = { high: "High", medium: "Medium", low: "Low" } as const;

/** Phase B: what an inbox line is for, as the inbox item's own screen offers it. Phase N's my_decisions reads it too. */
export const OFFER: Partial<Record<InboxCause, readonly CommandAct[]>> = {
  approve: ["approve", "decline"],
  clear: ["approve", "decline"],
  confirm_outcome: ["approve", "decline"],
  confirm_clear: ["resolve"],
  status_set_with_no_reason: ["give_reason"],
  blocked_without_blocker: ["unblock"],
};

export function subjectOf(s: InboxSubject): CommandSubject | undefined {
  if (s.type === "braid_entry" || s.type === "work_item") return { type: s.type, id: s.id, projectId: s.projectId };
  return s.type === "project" ? { type: "project", id: s.id, projectId: s.id } : undefined;
}

/**
 * QA1: the asker's updates waiting for review, with each item that needs their OK, then their inbox,
 * worst first. Section 18: with a project, only what is about that project (a named project's status).
 */
export async function needsYou(conn: Conn, viewerId: string, now: Date, onProject: string | null = null): Promise<{ cards: DraftCard[]; sentences: string[] }> {
  const waiting = (await conn.select().from(t.captures).where(inArray(t.captures.state, ["proposed", "reviewing"])))
    .filter((c) => c.authorId === viewerId)
    .sort((a, b) => a.messageAt.getTime() - b.messageAt.getTime());
  const cards: DraftCard[] = [];
  const sentences: string[] = [];
  for (const c of waiting) {
    const review = await getReview(conn, viewerId, c.id);
    if (!review.found) continue;
    const groups = onProject ? review.groups.filter((g) => g.type === "project" && g.projectId === onProject) : review.groups;
    const needOk = groups.flatMap((g) => g.items.map((i) => ({ i, where: g.type === "project" ? g.name : g.label }))).filter(({ i }) => i.state === "needs_ok");
    const when = clockTime(c.messageAt);
    if (needOk.length) {
      sentences.push(`Your update from ${when} has ${counted(needOk.length, "item", "items")} waiting for your OK before it can be saved.`);
      for (const { i, where } of needOk) {
        cards.push({ title: i.title, detail: `${where}: ${i.change}`, tag: `Needs your OK · ${CONFIDENCE[i.confidence]} confidence`, href: `/review/${c.id}`, accept: { captureId: c.id, itemId: i.id } });
      }
    } else if (!onProject || groups.length) {
      sentences.push(`Your update from ${when} is ready to save.`);
      cards.push({ title: `Your update from ${when}`, detail: "Everything in it is ready; save it to update your projects", tag: "Ready to save", href: `/review/${c.id}`, review: { captureId: c.id } });
    }
  }
  const inbox = (await getInbox(conn, viewerId, now)).items
    .filter((i) => !(i.subject.type === "capture" && waiting.some((c) => c.id === i.subject.id)))
    .filter((i) => !onProject || i.project?.id === onProject);
  for (const i of inbox) {
    const subject = subjectOf(i.subject);
    cards.push({ title: i.title, detail: `Why: ${i.why}`, tag: i.groupLabel, href: `/?view=inbox&item=${encodeURIComponent(i.id)}`, ...(subject ? { subject, offer: OFFER[i.cause] ?? [] } : {}) });
  }
  if (inbox.length) sentences.push(`${counted(inbox.length, "item is", "items are")} in your inbox.`);
  return { cards, sentences };
}

export const needsMe: AnswerBuilder = async (conn, viewerId, _question, now) => {
  const { cards, sentences } = await needsYou(conn, viewerId, now);
  if (!cards.length) return { text: "Nothing needs you right now.", cards: [], more: null };
  return { text: sentences.join(" "), ...capped(cards, { label: "in your inbox", href: "/?view=inbox" }) };
};
