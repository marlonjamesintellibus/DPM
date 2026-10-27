// What needs the asker (section 15, QA1, QA9; section 17 for the cards and Accept).
import { inArray } from "drizzle-orm";
import * as t from "../../db/schema";
import type { AnswerCard } from "../../domain/question";
import { getInbox } from "../inbox";
import { clockTime } from "../project";
import { getReview } from "../review";
import { capped, counted, type AnswerBuilder } from "./shared";

const CONFIDENCE = { high: "High", medium: "Medium", low: "Low" } as const;

/** QA1: the asker's updates waiting for review, with each item that needs their OK, then their inbox, worst first. */
export const needsMe: AnswerBuilder = async (conn, viewerId, _question, now) => {
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
};
