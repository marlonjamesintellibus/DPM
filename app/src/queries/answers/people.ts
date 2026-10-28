// About people (conversational plan, phase H, PP1 to PP8). What someone has: the work, milestones and
// entries they own on projects the asker shares with them, with how many are past due and nothing more
// (PP6), and their leave only where the project shows it (PP7), all as queries/people.ts allows (CD9).
// Who owns something: the owner of each record or entry on the asker's projects that the words match
// (PP5). What someone said: never (PP8). Who is meant is read among the people the asker shares a project
// with, so a name outside them gets the same words as a name nobody has (PP1); a first name two of them
// share is asked about, listing only them (PP2; through M21 in their own chat, CD50). The asker's own name
// is my_work (PP4). In a follow-up the newest words decide (CV8): "and Andre?" is about Andre, never the
// person asked about before.
import { eq, inArray } from "drizzle-orm";
import type { Conn } from "../../db/conn";
import * as t from "../../db/schema";
import { chosenAt, followUpRest, type AskedQuestion } from "../../domain/question";
import { asThing, ownedMatches, ownedPhrase, peopleAsked, whoIsMeant, type Meant, type Nameable } from "../../domain/topics/people";
import { leaveShownTo, ownedOn, personSeenBy, sharedPeople, type PersonSeen, type SharedPerson } from "../people";
import { readableProjects, todayIn, type PersonRef } from "../project";
import { myWork, workOrder } from "./my-work";
import { capped, counted, dayDate, forecastText, listed, projectsAsked, workTitle, type AnswerBuilder, type Body, type DraftCard } from "./shared";

/** PP1: the same words for someone the asker shares no project with, a name nobody has, and no name at all. */
export const NOBODY = "I can't tell you about them. Ask about someone you share a project with, by their name.";
/** PP8: what people say to Atlas is theirs (M1). The same words whoever is named. */
export const NOT_SAID = "What people say to Atlas stays theirs, so I can't share anyone's updates or messages. I can tell you what they are working on.";
/** PP5 with nothing to look for. */
export const OWNS_WHAT = "Say what you want the owner of, for example: Who owns #151?";

const none = (text: string): Body => ({ text, cards: [], more: null });
/** "Kemar Brown, Kemar Smith or Kemar Lee" */
const either = (names: readonly string[], and: string) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}` : (names[0] ?? ""));

/** CV8: a follow-up is read with the questions it follows, newest first. */
const wordsOf = (q: AskedQuestion) => [q.asked, ...(q.follows ?? [])];

export const people: AnswerBuilder = async (conn, viewerId, question, now) => {
  // CV8: the newest words that ask something of their own decide what is asked
  const asks = peopleAsked(wordsOf(question));
  if (asks === "said") return none(NOT_SAID);
  if (asks === "owner") return owner(conn, viewerId, question, now);
  return (await aboutSomeone(conn, viewerId, question, now)) ?? none(NOBODY);
};

/** The names and aliases of the projects the viewer reads: the places a follow-up can name ("and on GQ?"). */
export async function placesOf(conn: Conn, viewerId: string): Promise<string[]> {
  const ids = await readableProjects(conn, viewerId);
  if (!ids.length) return [];
  const rows = await conn.select({ name: t.projects.name, aliases: t.projects.aliases }).from(t.projects).where(inArray(t.projects.id, ids));
  return rows.flatMap((r) => [r.name, ...r.aliases]);
}

/**
 * CV8: who the words ask about, newest first. Words that name someone decide ("and Jodian?"); words that
 * only follow up and say where ("and on GQ?", "and GQ?") keep the one asked about before; any other words
 * mean whoever they name, so "and Andre?" and "and Zed?" mean nobody, never the person before (PP1).
 * CD50: a question Atlas asked who about means the one chosen there, by id, while the asker still shares a
 * project with them (P10); someone they no longer do is nobody, never the words read again.
 */
function whoIsAsked(question: AskedQuestion, shared: readonly Nameable[], places: readonly string[]): Meant {
  for (const [at, w] of wordsOf(question).entries()) {
    const chosen = chosenAt(question, "person", at);
    if (chosen) return shared.some((p) => p.id === chosen) ? { kind: "one", id: chosen, also: [] } : { kind: "nobody" };
    const meant = whoIsMeant(w, shared);
    if (meant.kind !== "nobody") return meant;
    const rest = followUpRest(w, places);
    if (rest === null || (rest && !places.some((p) => p.toLowerCase() === rest))) return meant;
  }
  return { kind: "nobody" };
}

/**
 * CD50: the buttons of a question that asked who, as the asker may see them now: only the people they still
 * share a project with, by name; two shown with the same full name also say the projects the asker shares
 * with each now. Built each time they are shown, never kept, so a project the asker has left since is never
 * named (P10, PP2).
 */
export async function whoShown<O extends { id: string; label: string }>(conn: Conn, viewerId: string, options: readonly O[]): Promise<O[]> {
  const shared = await sharedPeople(conn, viewerId);
  const fits = options.flatMap((o) => shared.filter((p) => p.id === o.id).map((p) => ({ o, p })));
  const twice = (p: SharedPerson) => fits.filter((x) => x.p.name === p.name).length > 1;
  const ids = [...new Set(fits.filter((x) => twice(x.p)).flatMap((x) => x.p.projectIds))];
  const names = ids.length ? await conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(inArray(t.projects.id, ids)) : [];
  const on = (p: SharedPerson) => p.projectIds.map((id) => names.find((n) => n.id === id)?.name ?? id).join(" and ");
  return fits.map(({ o, p }) => ({ ...o, label: twice(p) ? `${p.name} (${on(p)})` : p.name }));
}

/**
 * What the person the words mean has, or null when they mean nobody the asker shares a project with.
 * Phase C's WY8 hands a why about a person here, with `lead` said first.
 */
export async function aboutSomeone(conn: Conn, viewerId: string, question: AskedQuestion, now: Date, lead = ""): Promise<Body | null> {
  const shared = await sharedPeople(conn, viewerId);
  // CD50: the person chosen when M21 asked who, here or in a question this one follows (whoIsAsked)
  const meant = whoIsAsked(question, shared, await placesOf(conn, viewerId));
  if (meant.kind === "nobody") return null;
  const nameOf = (id: string) => shared.find((p) => p.id === id)!.name;
  if (meant.kind === "which") {
    // PP2: only people the asker shares a project with are listed. M21 asks who in their own chat, with a
    // button each (CD50), kept by name only: whoShown tells two of one name apart when shown; elsewhere a
    // reply by full name as a follow-up ("and Kemar Smith?") is read as one
    const names = meant.ids.map(nameOf);
    const body = none(`${lead}Did you mean ${either(names, "or")}? Ask again with their full name, for example "and ${names.at(-1)}?"`);
    return { ...body, which: { fits: "person", options: meant.ids.map((id) => ({ id, label: nameOf(id) })) } };
  }
  // PP6: one person at a time, the first named other than the asker; the answer says who was left out
  const named = [meant.id, ...meant.also];
  const id = named.find((x) => x !== viewerId) ?? viewerId;
  const others = named.filter((x) => x !== id && x !== viewerId).map(nameOf);
  const after = [
    others.length ? ` Ask about ${either(others, "and")} on their own.` : "",
    id !== viewerId && named.includes(viewerId) ? ` Ask "What am I working on?" for your own.` : "",
  ].join("");
  if (id === viewerId) {
    // PP4: a follow-up can come back to the asker ("and Kemar?" from Kemar); WY8 still says it gives no reasons
    const body = await myWork(conn, viewerId, { ...question, topic: "my_work" }, now);
    return { ...body, text: `${lead}${body.text}${after}` };
  }
  const seen = await personSeenBy(conn, viewerId, id, now, question.projectId);
  if (!seen) return null;
  if (!seen.projects.length) {
    const [p] = question.projectId ? await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, question.projectId)) : [];
    return none(`${lead}${seen.person.name} is not on ${p?.name ?? "that project"}.${after}`);
  }
  const body = whatTheyHave(seen, now);
  return { ...body, text: `${lead}${body.text}${after}` };
}

/** PP6: facts only, the counts and how many are past due; PP7 and W3-D5: leave, today's or the next, where the project shows it. */
function whatTheyHave(seen: PersonSeen, now: Date): Body {
  const today = todayIn(now);
  const { person } = seen;
  const work = [...seen.work].sort((a, b) => workOrder(a.w, b.w));
  const milestones = [...seen.milestones].sort((a, b) => a.m.forecastDate.localeCompare(b.m.forecastDate));
  const late = (date: string | null) => !!date && date < today;
  const cards: DraftCard[] = [
    ...work.map(({ project, w }): DraftCard => ({
      title: workTitle(w),
      detail: `${project.name}: ${w.dueDate ? `due ${dayDate(w.dueDate)}${late(w.dueDate) ? ", past due" : ""}` : "no due date"}${w.blockedNote ? `, ${w.blockedNote}` : ""}`,
      tag: w.stateLabel,
      href: `/projects/${project.id}`,
      subject: { type: "work_item", id: w.id, projectId: project.id },
    })),
    ...milestones.map(({ project, m }) => ({
      title: m.name,
      detail: `${project.name}: ${forecastText(m)}${late(m.targetDate) ? ", past its target" : ""}`,
      tag: `Milestone · ${m.statusLabel}`,
      href: `/projects/${project.id}`,
    })),
    ...seen.entries.map(({ project, e }): DraftCard => ({
      title: e.title,
      detail: `${project.name}: ${e.stateLabel}`,
      tag: e.kindLabel,
      href: `/projects/${project.id}?view=table&log=${e.kind}`,
      subject: { type: "braid_entry", id: e.id, projectId: project.id },
    })),
    // PP3: an outside contact's ties, as the project lists them
    ...seen.ties.flatMap(({ project, tie, work: tied, entries }) => [
      ...tied.map((w): DraftCard => ({ title: workTitle(w), detail: `${project.name}: ${tie}`, tag: w.stateLabel, href: `/projects/${project.id}`, subject: { type: "work_item", id: w.id, projectId: project.id } })),
      ...entries.map((e): DraftCard => ({
        title: e.title,
        detail: `${project.name}: names ${person.name}`,
        tag: e.kindLabel,
        href: `/projects/${project.id}?view=table&log=${e.kind}`,
        subject: { type: "braid_entry", id: e.id, projectId: project.id },
      })),
    ]),
  ];
  const where = seen.projects.length === 1 ? `on ${seen.projects[0].name}` : "on projects you share";
  const owned = listed([
    [work.length, "open work item", "open work items"],
    [milestones.length, "milestone", "milestones"],
    [seen.entries.length, "entry on the BRAID log", "entries on the BRAID log"],
  ]);
  const pastDue = work.filter(({ w }) => late(w.dueDate)).length + milestones.filter(({ m }) => late(m.targetDate)).length;
  const tiedCount = seen.ties.reduce((n, x) => n + x.work.length + x.entries.length, 0);
  const sentences = [
    owned
      ? `${person.name} has ${owned} ${where}; ${pastDue ? `${pastDue} ${pastDue === 1 ? "is" : "are"} past due` : "none is past due"}.`
      : seen.ties.length
        ? null
        : `${person.name} has nothing open ${where}.`,
    seen.ties.length
      ? `${person.name} is an outside contact ${where}${tiedCount ? `, tied to ${counted(tiedCount, "thing", "things")} there` : ""}.`
      : null,
    seen.onLeaveUntil ? `${person.name} is on leave until ${dayDate(seen.onLeaveUntil)}.` : null,
    seen.leaveAhead ? `${person.name} is away ${dayDate(seen.leaveAhead.start)} to ${dayDate(seen.leaveAhead.end)}.` : null,
  ];
  return { text: sentences.filter(Boolean).join(" "), ...capped(cards, { label: `of ${person.name}'s`, href: "/projects" }) };
}

type Owned = { title: string; number: string | null; kind?: string; label: string; owner: PersonRef | null; projectId: string; project: string; tag: string; href: string; card: Partial<DraftCard> };

/**
 * PP5, CV8: what the words ask the owner of, newest first: "and the trend model?" after "Who owns the
 * store feed?" asks after the trend model; "and on GQ?" asks after the store feed again, on GQ.
 */
function thingAsked(words: readonly string[], places: readonly string[]): string | null {
  for (const w of words) {
    const phrase = ownedPhrase(w);
    if (phrase) return phrase;
    const rest = followUpRest(w, places);
    if (rest) return asThing(rest);
  }
  return null;
}

/** PP5: who owns each thing on the asker's projects that the words match, best match only. */
async function owner(conn: Conn, viewerId: string, question: AskedQuestion, now: Date): Promise<Body> {
  const phrase = thingAsked(wordsOf(question), await placesOf(conn, viewerId));
  if (!phrase) return none(OWNS_WHAT);
  const views = await projectsAsked(conn, viewerId, question.projectId, now);
  const things: Owned[] = views.flatMap((v) => {
    const at = { projectId: v.project.id, project: v.project.name, href: `/projects/${v.project.id}` };
    // CD9: only what the project shows as someone's, as "What is Kemar working on?" reads it
    const { work, milestones, entries } = ownedOn(v);
    return [
      // A project by its name: its owner. Aliases are not searched, so "GQ" stays a word in a title
      { ...at, title: v.project.name, number: null, label: v.project.name, owner: v.project.owner, tag: "Project", card: {} },
      ...work.map((w) => ({ ...at, title: w.title, number: w.number, label: workTitle(w), owner: w.owner, tag: w.stateLabel, card: { subject: { type: "work_item" as const, id: w.id, projectId: v.project.id } } })),
      ...milestones.map((m) => ({ ...at, title: m.name, number: null, label: m.name, owner: m.owner, tag: `Milestone · ${m.statusLabel}`, card: {} })),
      ...entries.map((e) => ({
        ...at,
        title: e.title,
        number: null,
        kind: e.kind,
        label: e.title,
        owner: e.owner,
        tag: e.kindLabel,
        href: `/projects/${v.project.id}?view=table&log=${e.kind}`,
        card: { subject: { type: "braid_entry" as const, id: e.id, projectId: v.project.id } },
      })),
    ];
  });
  const found = ownedMatches(phrase, things);
  if (!found.length) return none(`Nothing open on your projects matches "${phrase}". Try its number, or its name as the project shows it.`);
  // PP7: an owner's leave, where the project shows it to the asker
  const away = new Map<string, string | null>();
  for (const f of found) {
    if (f.owner && f.owner.id !== viewerId && !away.has(`${f.owner.id}@${f.projectId}`)) {
      const until = await leaveShownTo(conn, viewerId, f.owner.id, [f.projectId], now);
      away.set(`${f.owner.id}@${f.projectId}`, until ? `on leave until ${dayDate(until)}` : null);
    }
  }
  const whose = (f: Owned) => {
    const leave = f.owner ? away.get(`${f.owner.id}@${f.projectId}`) : null;
    return f.owner ? `${f.owner.id === viewerId ? "you" : f.owner.name}${leave ? `, ${leave}` : ""}` : "nobody yet";
  };
  const cards: DraftCard[] = found.map((f) => ({ title: f.label, detail: `${f.project}: ${whose(f)}`, tag: f.tag, href: f.href, ...f.card }));
  if (found.length > 1) return { text: `${counted(found.length, "thing", "things")} on your projects match "${phrase}". Each says who owns it.`, ...capped(cards, { label: "matches", href: "/projects" }) };
  const [f] = found;
  const on = f.tag === "Project" ? "" : ` on ${f.project}`;
  const leave = f.owner ? away.get(`${f.owner.id}@${f.projectId}`) : null;
  const text = !f.owner
    ? `Nobody owns ${f.label}${on} yet.`
    : `${f.owner.id === viewerId ? "You own" : `${f.owner.name} owns`} ${f.label}${on}.${leave ? ` ${f.owner.name} is ${leave}.` : ""}`;
  return { text, cards, more: null };
}
