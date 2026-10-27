// Who mentioned the asker (section 18, CQ8 to CQ11): in the last mentionsDays, other people's words on
// the asker's projects that name them, from quotes the asker may see by rule 9, as the project view
// shows them (visibleQuotes). Words routed to a project they are not in never reach them, and are not
// counted (CQ8); a report taken back is not on the log, so it is not a mention (CQ11); their own words
// are not (CQ10). Newest first.
import { and, eq, inArray } from "drizzle-orm";
import * as t from "../../db/schema";
import { config } from "../../domain/config";
import type { AnswerCard } from "../../domain/question";
import { namesPerson } from "../../domain/topics/mentions";
import { daysAgo, firstName, peopleById, projectReader, visibleQuotes, type PersonRef } from "../project";
import { capped, counted, projectsAsked, type AnswerBuilder } from "./shared";

const DAY_MS = 86_400_000;

type Said = { who: PersonRef; at: Date; quote: string; tag: string; href: string };

export const mentions: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const named = views.length === 1 && projectId ? views[0] : null;
  const { world } = await projectReader(conn, viewerId);
  const from = new Date(now.getTime() - config.mentionsDays * DAY_MS);
  const inWindow = (at: Date) => at >= from && at <= now;
  const people = await peopleById(conn, [viewerId, ...world.memberships.map((m) => m.personId)]);
  const me = people.get(viewerId)?.name ?? viewerId;
  const found: { project: string; said: Said }[] = [];

  for (const v of views) {
    const said: Said[] = [];
    // Reports on the BRAID log, with the quote the project view shows this viewer (rule 9)
    for (const e of v.braid.entries) {
      for (const s of e.sources) {
        if (s.quote && s.person.id !== viewerId && inWindow(s.at)) said.push({ who: s.person, at: s.at, quote: s.quote, tag: e.kindLabel, href: `/projects/${v.project.id}?view=table&log=${e.kind}` });
      }
    }
    // Changes saved into this project from other people's words, by the same rule 9 check
    const applied = (
      await conn
        .select({ row: t.extractions, authorId: t.captures.authorId, messageAt: t.captures.messageAt })
        .from(t.extractions)
        .innerJoin(t.captures, eq(t.captures.id, t.extractions.captureId))
        .where(and(eq(t.extractions.state, "applied"), inArray(t.extractions.projectId, [v.project.id])))
    ).filter(({ row, authorId, messageAt }) => row.kind === "update" && authorId !== viewerId && inWindow(messageAt));
    const spans = applied.flatMap(({ row }) => row.draft.spans.map((span, i) => ({ id: `${row.id}:${i}`, captureId: row.captureId, extractionId: row.id, span })));
    const quotes = await visibleQuotes(conn, viewerId, v.project.id, world, spans);
    for (const { row, authorId, messageAt } of applied) {
      for (let i = 0; i < row.draft.spans.length; i++) {
        const quote = quotes.get(`${row.id}:${i}`);
        if (quote) said.push({ who: people.get(authorId) ?? { id: authorId, name: authorId }, at: messageAt, quote, tag: "Update", href: `/projects/${v.project.id}` });
      }
    }
    // CQ9: a first name counts only where no other member of this project has it
    const shared = world.memberships.some((m) => m.projectId === v.project.id && m.state === "member" && m.personId !== viewerId && firstName(people.get(m.personId)?.name ?? "") === firstName(me));
    const seen = new Set<string>();
    for (const s of said) {
      // One quote feeds a report and a change alike; it is one mention
      const key = `${s.who.id}|${s.at.getTime()}|${s.quote}`;
      if (seen.has(key) || !namesPerson(s.quote, me, shared)) continue;
      seen.add(key);
      found.push({ project: v.project.name, said: s });
    }
  }

  found.sort((a, b) => b.said.at.getTime() - a.said.at.getTime() || a.said.quote.localeCompare(b.said.quote));
  const on = named ? ` on ${named.project.name}` : "";
  const window = `in the last ${config.mentionsDays} days`;
  if (!found.length) return { text: `Nobody has mentioned you${on} ${window}.`, cards: [], more: null };
  const cards: AnswerCard[] = found.map(({ project, said: s }) => ({
    title: `${firstName(s.who.name)} on ${project}`,
    detail: `${daysAgo(s.at, now).replace(/^./, (c) => c.toUpperCase())}: "${s.quote}"`,
    tag: s.tag,
    href: s.href,
  }));
  return { text: `You were mentioned ${counted(found.length, "time", "times")}${on} ${window}.`, ...capped(cards, { label: "on your projects", href: "/projects" }) };
};
