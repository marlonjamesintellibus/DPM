// Who has no update saved today (conversational plan, phase N, LD1 to LD3, LD5, LD6, LD9, LD10).
// Answered only for the projects where the asker is a PM or Lead, read from their role when it is
// answered, so a PM on Forager and a member on GQ hears about Forager only; a member anywhere hears that
// only PMs and Leads can see it, and nothing about anyone (LD1). Someone has updated a project today when
// an update they sent today, from any channel (LD9), is saved with something about that project. One
// still in its author's review is theirs alone until they save it (rule 9, M1, PP8), so it is never
// counted, nor hinted at: the answer says "saved". Only who and where are read, never the words (names
// only). Members only, so outside contacts are never listed (LD5); someone on leave today is not missing,
// and is named as on leave as the project shows it to its PMs and Leads (LD2, PP7). Today only (CD16,
// LD10); before the standup time, or on a weekend, nobody is late yet (CD27, LD3).
import { and, eq, gte, inArray } from "drizzle-orm";
import * as t from "../../db/schema";
import { config } from "../../domain/config";
import { addDays, isWorkingDay, weekday } from "../../domain/dates";
import { asksAnotherDay } from "../../domain/topics/not-updated";
import { leaveShownTo } from "../people";
import { clockOf, clockWords, projectReader, todayIn } from "../project";
import { capped, counted, dayDate, projectsAsked, type AnswerBuilder, type Body, type DraftCard } from "./shared";

/** LD1: the same words whatever their projects hold. */
export const LEADS_ONLY = "Only PMs and Leads can see that.";
/** LD10, CD16: no history of who missed which day. */
export const TODAY_ONLY = "I can only tell you who hasn't updated today. DPM keeps no record of who missed which day.";

const none = (text: string): Body => ({ text, cards: [], more: null });

/** "Jodian Taylor", "Jodian Taylor and Kemar Brown", "A, B and C" */
const together = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? ""));

export const notUpdated: AnswerBuilder = async (conn, viewerId, question, now) => {
  // Rule 7: the role is read now, per project, and first, so a member hears LD1 whatever they ask; P10:
  // only projects they read
  const views = await projectsAsked(conn, viewerId, question.projectId, now);
  const led = views.filter((v) => v.viewerRole === "pm" || v.viewerRole === "lead");
  if (!led.length) return none(question.projectId && views.length === 1 ? `Only PMs and Leads of ${views[0].project.name} can see that.` : LEADS_ONLY);

  // LD10: "And last week?" after "Who hasn't updated today?" asks for a history DPM does not keep
  const today = todayIn(now);
  if (asksAnotherDay([question.asked, ...(question.follows ?? [])], weekday(today))) return none(TODAY_ONLY);

  // LD3, CD27: nobody is late before the standup time, nor on a weekend (CD7)
  if (!isWorkingDay(today)) return none("It's the weekend, so nobody is expected to send an update today.");
  if (clockOf(now) < config.standupTime) return none(`It's early: updates usually come in by ${clockWords(config.standupTime)}. Ask again after that.`);

  const reader = await projectReader(conn, viewerId);
  const ids = led.map((v) => v.project.id);
  const members = reader.world.memberships.filter((m) => ids.includes(m.projectId) && m.state === "member" && m.personId !== viewerId);
  const names = new Map(
    members.length
      ? (await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, [...new Set(members.map((m) => m.personId))]))).map((p) => [p.id, p.name])
      : [],
  );
  // LD9: each update sent today, from any channel, saved with something about the project: filed there,
  // or saying it had no change. Rule 9: one still in its author's review, or whose part about the project
  // they turned down, is theirs alone. Only who and where are read, never the words
  const sent = ids.length
    ? await conn
        .selectDistinct({ authorId: t.captures.authorId, projectId: t.extractions.projectId, messageAt: t.captures.messageAt })
        .from(t.extractions)
        .innerJoin(t.captures, eq(t.captures.id, t.extractions.captureId))
        .where(
          and(
            inArray(t.extractions.projectId, ids),
            eq(t.captures.state, "saved"),
            inArray(t.extractions.state, ["applied", "no_change"]),
            gte(t.captures.messageAt, new Date(`${addDays(today, -1)}T00:00:00Z`)),
          ),
        )
    : [];
  const updated = (personId: string, projectId: string) => sent.some((s) => s.authorId === personId && s.projectId === projectId && s.messageAt <= now && todayIn(s.messageAt) === today);

  const sentences: string[] = [];
  const onLeave: string[] = [];
  const cards: DraftCard[] = [];
  // Each person on leave is named once, however many of these projects they are on
  const named = new Set<string>();
  for (const v of led) {
    const theirs = members.filter((m) => m.projectId === v.project.id).sort((a, b) => (names.get(a.personId) ?? "").localeCompare(names.get(b.personId) ?? ""));
    // LD6: nobody else on it
    if (!theirs.length) {
      sentences.push(`Only you on ${v.project.name}.`);
      continue;
    }
    const missing: string[] = [];
    // LD2: someone on leave on this project, so "or is on leave" is about this project's people only
    let anyAway = false;
    for (const m of theirs) {
      if (updated(m.personId, v.project.id)) continue;
      // LD2, PP7: leave as the project shows it to its PMs and Leads
      const until = await leaveShownTo(conn, viewerId, m.personId, [v.project.id], now, reader);
      const name = names.get(m.personId) ?? m.personId;
      if (until) {
        if (!named.has(m.personId)) onLeave.push(`${name} is on leave until ${dayDate(until)}.`);
        named.add(m.personId);
        anyAway = true;
        continue;
      }
      missing.push(name);
      cards.push({ title: name, detail: `${v.project.name}: no update saved today`, tag: "No update saved today", href: `/projects/${v.project.id}` });
    }
    sentences.push(
      missing.length
        ? `${counted(missing.length, "person has", "people have")} no update saved today on ${v.project.name}: ${together(missing)}.`
        : `Everyone on ${v.project.name} has saved an update today${anyAway ? ", or is on leave" : ""}.`,
    );
  }
  return { text: [...sentences, ...onLeave].join(" "), ...capped(cards, { label: "with no update saved today", href: "/projects" }) };
};
