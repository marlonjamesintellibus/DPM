// Phase G, M25: what "Draft my standup" did, in DPM's own words (the draft was asked for while the message was
// read; its id is in question.made). The draft itself follows under the reply as a card, written by Atlas while
// the chat shows it drafting. With no draft, the reply says why: which project (a client status and a weekly
// summary are about one), only a PM or Lead may ask for those (DR3, checked when it ran), or it was asked for
// outside their own chat. Only projects the asker can read are ever named (P10).
import { and, eq } from "drizzle-orm";
import * as t from "../../db/schema";
import { DRAFT_LABEL, type DraftKind } from "../../domain/drafts";
import { mayDraft } from "../drafts";
import { readableProjects } from "../project";
import type { AnswerBuilder } from "./shared";

const ASK_FOR: Record<Exclude<DraftKind, "standup">, (project: string) => string> = {
  client: (p) => `Draft a client status for ${p}`,
  weekly: (p) => `Draft the weekly summary for ${p}`,
  prep: (p) => `Prep me for the ${p} call`,
};

export const draft: AnswerBuilder = async (conn, viewerId, question) => {
  const say = (text: string) => ({ text, cards: [], more: null });
  const kind = question.draft ?? "standup";
  const id = question.made?.[0];
  const [row] = id ? await conn.select().from(t.drafts).where(and(eq(t.drafts.id, id), eq(t.drafts.ownerId, viewerId))) : [];
  // Phase O: a call brief's project is the one DPM found, not one the words named
  const projectId = row?.projectId ?? question.projectId;
  const [project] = projectId ? await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, projectId)) : [];
  if (row) {
    // "since yesterday", "since 9:11am", "since Fri 16 Oct": the first part's title, as the draft says it (DR1)
    const since = row.facts.sections[0]?.title.replace(/^S/, "s") ?? "lately";
    if (row.kind === "standup") return say(`Here's a draft of your standup, from what you saved ${since} and your open work. Edit it, then copy it.`);
    // Phase O: client-safe by default, whoever asks (MT10)
    if (row.kind === "prep") return say(`Here's a brief for your call about ${project?.name}. It holds only what the client may see: the releases, the status once its reason is shared, and what waits on them. Edit it, then copy it.`);
    if (row.kind === "weekly") return say(`Here's a draft weekly summary for ${project?.name}, for this week so far. Edit it, then copy it.`);
    const shared = row.facts.sections.some((s) => s.facts.some((f) => f.key.startsWith("status:")));
    return say(
      `Here's a draft client status for ${project?.name}. It holds only what the client view shows: the releases${shared ? " and the status you shared" : ""}. Edit it, then copy it.${shared ? "" : " The status goes in only once its reason is shared with the client, from the project page."}`,
    );
  }
  // Phase O, MT9: the call could be about 2 or 3 of their projects, and DPM asked which (M21)
  if (kind === "prep" && id?.startsWith("clr-")) return say("I'll write the brief once you say which project the call is about.");
  if (kind === "prep" && !question.projectId) {
    const [first] = (await readableProjects(conn, viewerId)).sort();
    const [named] = first ? await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, first)) : [];
    return say(named ? `I can't tell which of your projects the call is about. Say it again with its name, for example "${ASK_FOR.prep(named.name)}".` : "You have no project to brief you on yet.");
  }
  if (kind !== "standup" && !question.projectId) {
    const led: string[] = [];
    for (const p of await readableProjects(conn, viewerId)) if (await mayDraft(conn, viewerId, kind, p)) led.push(p);
    if (!led.length) return say(`Only a PM or Lead of a project can draft a ${DRAFT_LABEL[kind]}.`);
    const [first] = await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, led.sort()[0]));
    return say(`Which project is it for? Say it again with its name, for example "${ASK_FOR[kind](first.name)}".`);
  }
  // DR3: checked when it ran, and the project is one they read (checkQuestion keeps no other)
  if (kind !== "standup" && !(await mayDraft(conn, viewerId, kind, question.projectId))) return say(`Only a PM or Lead of ${project?.name ?? "the project"} can draft a ${DRAFT_LABEL[kind]}.`);
  return say("I write drafts only in your own chat with me.");
};
