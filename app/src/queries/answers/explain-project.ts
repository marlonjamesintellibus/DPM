// What a project is (conversational plan, phase Q, EX1 to EX6): who it is for and when it runs, its owner
// and how it stands; its threads, what each is for and who owns their milestones and work; the next
// milestones; the five most recent approved decisions; and where the asker starts on it. All from the
// project view the asker reads (getProject), so members only (EX1, P10), and a decision's quote only where
// rule 9 lets them read it (EX3). An outside contact gets the client view of a project they are tied to,
// and nothing else (EX4). A name that fits 2 or 3 of their projects asks which (EX5): M21 asks it in their
// own chat with a button each (CD50), and elsewhere the asker says the name again. Asked in a group (EX6)
// waits for phase I: this answer reads the asker's own view (thread owners, their work, decision quotes), so
// a group answer needs its own builder from the group's shared facts (rule 8), never this one.
import { inArray } from "drizzle-orm";
import * as t from "../../db/schema";
import type { IsoDate } from "../../domain/dates";
import { chosenAt, type AnswerCard, type AskedQuestion, type Which } from "../../domain/question";
import { namesSomething, projectFits } from "../../domain/topics/explain-project";
import { clientViews, type ClientView } from "../client-view";
import { firstName, getProject, readableProjects, type ProjectBraidEntry, type ProjectMilestone, type ProjectView, type ProjectWorkItem } from "../project";
import { capped, counted, dayDate, forecastText, milestonesOf, workOf, workTitle, type AnswerBuilder, type Body, type DraftCard } from "./shared";

/** EX1: the same words whether the project is not theirs or never was. */
export const NOT_FOUND = "I can't find that in your projects.";

/** Phase Q: the plan's "five most recent approved decisions". */
const DECISIONS_SHOWN = 5;
/** The next milestones by forecast. */
const MILESTONES_SHOWN = 3;

const none = (text: string): Body => ({ text, cards: [], more: null });

/** "A", "A or B", "A, B or C" */
function either(names: readonly string[], joiner = "or"): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}` : (names[0] ?? "");
}

/** "from Mon 12 Oct to Fri 6 Nov"; whatever the project has of its dates. */
function runs(p: { startDate: IsoDate | null; endDate: IsoDate | null }): string {
  if (p.startDate && p.endDate) return `from ${dayDate(p.startDate)} to ${dayDate(p.endDate)}`;
  if (p.startDate) return `from ${dayDate(p.startDate)}`;
  if (p.endDate) return `until ${dayDate(p.endDate)}`;
  return "with no dates set yet";
}

const forWhom = (p: { customer: string | null }) => (p.customer ? `for ${p.customer}` : "an internal project");

/**
 * EX5: the project the words mean, among the asker's own. The one chosen when M21 asked which wins, then a
 * project Atlas named and the asker reads; otherwise the words, then those of the questions a follow-up
 * follows ("and where do I start?"), where a question Atlas asked which about means the one chosen (CD50).
 */
type Picked<P> = { project: P } | { which: P[] } | { notFound: true } | { choose: P[] };

function pickProject<P extends { id: string; name: string; aliases: readonly string[] }>(question: AskedQuestion, projects: readonly P[]): Picked<P> {
  const { asked, follows = [], projectId } = question;
  const named = projects.find((p) => p.id === (chosenAt(question, "project", 0) ?? projectId));
  if (named) return { project: named };
  // EX1: a name that is none of theirs is not found, never confirmed or denied. Each question's words are read
  // in full before the one before it, so "and Store Insights?" after "What is Forager?" is never Forager, and
  // "and where do I start?" after "What is Atlas Bank?" is not found either (phase Q fix).
  if (!projects.length) return { notFound: true };
  for (const [at, words] of [asked, ...follows].entries()) {
    // CD50, P10: the one chosen while it is still theirs; one they have left since is not found, as any is
    const chosen = at > 0 ? chosenAt(question, "project", at) : null;
    if (chosen) {
      const p = projects.find((x) => x.id === chosen);
      return p ? { project: p } : { notFound: true };
    }
    const fits = projectFits(words, projects);
    if (fits.length > 1) return { which: fits };
    if (fits.length === 1) return { project: fits[0] };
    if (namesSomething(words)) return { notFound: true };
  }
  return projects.length === 1 ? { project: projects[0] } : { choose: [...projects] };
}

/** CD50: the projects that fit, for M21 to ask which; it asks only when there are 2 or 3. */
const whichOf = (fits: readonly { id: string; name: string }[]): Which => ({ fits: "project", options: fits.map((p) => ({ id: p.id, label: p.name })) });

export const explainProject: AnswerBuilder = async (conn, viewerId, question, now) => {
  const readable = await readableProjects(conn, viewerId);
  // EX4: someone who reads no project as a member may be an outside contact, who reads the client view only
  if (!readable.length) return forClient(question, await clientViews(conn, viewerId));

  const projects = (await conn.select({ id: t.projects.id, name: t.projects.name, aliases: t.projects.aliases }).from(t.projects).where(inArray(t.projects.id, readable))).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const pick = pickProject(question, projects);
  const card = (p: { id: string; name: string }): AnswerCard => ({ title: p.name, detail: null, tag: "Project", href: `/projects/${p.id}` });
  if ("notFound" in pick) return none(`${NOT_FOUND} You can ask about ${either(projects.map((p) => p.name))}.`);
  // EX5: 2 or 3 of theirs fit, or none is named and they are on 2 or 3: M21 asks which in their own chat
  // (CD50); where it cannot, the asker says it again (wave 2, AC7)
  if ("which" in pick) return { text: `Did you mean ${either(pick.which.map((p) => `"${p.name}"`))}? Say it again with its name.`, cards: pick.which.map(card), more: null, which: whichOf(pick.which) };
  if ("choose" in pick) return { text: `Which project? You are on ${either(pick.choose.map((p) => p.name), "and")}. Ask about one by its name.`, cards: pick.choose.map(card), more: null, which: whichOf(pick.choose) };

  // Rule 4: read now; a project they have left reads as one that never was
  const v = await getProject(conn, viewerId, pick.project.id, now);
  if (!v.found) return none(NOT_FOUND);
  return explain(v, viewerId);
};

/** Who owns a thread's milestones and work, by first name, in the order they first appear. */
function ownersOf(th: ProjectView["threads"][number]): string[] {
  const people = [...th.milestones.map((m) => m.owner), ...th.workItems.filter((w) => w.state !== "cancelled").map((w) => w.owner)];
  return [...new Set(people.flatMap((p) => (p ? [firstName(p.name)] : [])))];
}

/** Not done, nor missed: a milestone that can still come. */
const ahead = (m: ProjectMilestone) => m.state === "planned" || m.state === "in_progress";
const open = (w: ProjectWorkItem) => w.state !== "done" && w.state !== "cancelled";

function explain(v: ProjectView, viewerId: string): Body {
  const p = v.project;
  const href = `/projects/${p.id}`;
  const milestones = milestonesOf(v);
  const next = milestones
    .filter(ahead)
    .sort((a, b) => a.forecastDate.localeCompare(b.forecastDate) || a.name.localeCompare(b.name))
    .slice(0, MILESTONES_SHOWN);
  // EX3: an approved decision shows wherever it came from; its words only when rule 9 lets this viewer read them
  const approved = v.braid.entries
    .filter((e) => e.kind === "decision" && e.state === "approved")
    .sort((a, b) => (b.decidedOn ?? b.updatedOn).localeCompare(a.decidedOn ?? a.updatedOn) || a.title.localeCompare(b.title));
  const decisions = approved.slice(0, DECISIONS_SHOWN);

  // Where to start: their own open work by due date, else a milestone of theirs still to come
  const mine = workOf(v)
    .filter((w) => w.owner?.id === viewerId && open(w))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || workTitle(a).localeCompare(workTitle(b)));
  const myMilestone = milestones.filter((m) => m.owner?.id === viewerId && ahead(m)).sort((a, b) => a.forecastDate.localeCompare(b.forecastDate))[0];

  const status = v.displayed.status ? `It is ${v.displayed.label}, ${v.displayed.from === "set" ? `as ${v.setStatus?.setBy ? firstName(v.setStatus.setBy.name) : "its owner"} set it` : "worked out from its plan"}.` : "It has no status yet: nothing on it has a date.";
  const plan = (() => {
    // EX2, P11: an empty plan says so, and how it gets filled
    if (!v.threads.length && !milestones.length) {
      // The words the plan card uses for an empty plan
      return "It has no threads or milestones yet. They come from GitHub and from updates people give Atlas.";
    }
    const threads = v.threads.length ? `It has ${counted(v.threads.length, "thread", "threads")}: ${either(v.threads.map((th) => th.name), "and")}.` : "It has no threads yet.";
    const milestone = next.length ? `The next milestone is ${next[0].name}, ${forecastText(next[0])}.` : milestones.length ? "No milestones left on it." : "It has no milestones yet.";
    return `${threads} ${milestone}`;
  })();
  // Named here as well as on their cards: MF11's eight cards seldom reach them on a project with a plan
  const titles = either(decisions.map((e) => `"${e.title}"`), "and");
  const decided = approved.length
    ? `${counted(approved.length, "decision is", "decisions are")} approved on it${approved.length > DECISIONS_SHOWN ? `; the latest are ${titles}` : `: ${titles}`}.`
    : "No decisions are approved on it yet.";
  const start = mine.length
    ? `Where to start: you have ${counted(mine.length, "open work item", "open work items")} on it, first ${workTitle(mine[0])}${mine[0].dueDate ? `, due ${dayDate(mine[0].dueDate)}` : ""}.`
    : myMilestone
      ? `Where to start: you own the milestone ${myMilestone.name}, ${forecastText(myMilestone)}.`
      : p.owner?.id === viewerId
        ? "Where to start: no work on it is yours yet; you own the project, so start with its plan."
        : `Where to start: nothing on it is yours yet, so ask ${p.owner ? firstName(p.owner.name) : "its PM"} where to begin.`;
  const lead = `${p.name} is ${forWhom(p)}, ${runs(p)}${p.owner ? `, and ${p.owner.name} owns it` : ""}.`;

  const cards: DraftCard[] = [
    { title: p.name, detail: `${p.customer ? `For ${p.customer}` : "Internal"}, ${runs(p)}${p.owner ? `; ${firstName(p.owner.name)} owns it` : ""}`, tag: v.displayed.label, href },
    ...(mine.length
      ? [
          {
            title: workTitle(mine[0]),
            detail: `${p.name}: ${mine[0].stateLabel}${mine[0].dueDate ? `, due ${dayDate(mine[0].dueDate)}` : ""}`,
            tag: "Where to start",
            href,
            subject: { type: "work_item" as const, id: mine[0].id, projectId: p.id },
            offer: ["mark_done", "unblock"] as const,
          },
        ]
      : []),
    ...v.threads.map((th): AnswerCard => {
      const owners = ownersOf(th);
      // A description that ends its own sentence is not given a second full stop
      const what = (th.description ?? "No description yet").trim();
      return { title: th.name, detail: `${what}${/[.!?]$/.test(what) ? "" : "."} ${owners.length ? `${either(owners, "and")} ${owners.length === 1 ? "owns" : "own"} its milestones and work` : "Nothing in it has an owner yet"}`, tag: `Thread · ${th.statusLabel}`, href };
    }),
    ...next.map((m): AnswerCard => ({ title: m.name, detail: `${p.name}: ${forecastText(m)}${m.owner ? `; ${firstName(m.owner.name)} owns it` : ""}`, tag: `Next milestone · ${m.statusLabel}`, href })),
    ...decisions.map((e): AnswerCard => ({ title: e.title, detail: decisionLine(v, e), tag: "Decision · Approved", href: `${href}?view=table&log=decision` })),
  ];
  // MF11: the project and where to start come first, so what is cut is the rest of what the project page shows
  return { text: [lead, status, plan, decided, start].join(" "), ...capped(cards, { label: `on ${p.name}`, href }) };
}

/** "Forager 2.0: approved by Alicia on Wed 14 Oct. From: "..."" (EX3: the words only when they may be read). */
function decisionLine(v: ProjectView, e: ProjectBraidEntry): string {
  const quote = e.sources.find((s) => s.quote)?.quote;
  return `${v.project.name}: approved by ${e.decidedBy ? firstName(e.decidedBy.name) : "a PM or Lead"}${e.decidedOn ? ` on ${dayDate(e.decidedOn)}` : ""}${quote ? `. From: "${quote}"` : ""}`;
}

/**
 * EX4: an outside contact reads the client view of the projects they are tied to: who it is for, when it
 * runs, and its releases with their planned dates. No status, people, threads, work or decisions, and no
 * cards, since they open no project page. Anything else is not found, as for a member (EX1). CD50: a
 * choice among their client views is asked as a member's is, and the one chosen is one of those views or
 * nothing. A project Atlas named is not read here, as before: only the words and the one chosen.
 */
function forClient(question: AskedQuestion, views: readonly ClientView[]): Body {
  const projects = views.map((v) => v.project);
  const pick = pickProject({ ...question, projectId: null }, projects);
  if ("notFound" in pick) return none(projects.length ? `${NOT_FOUND} You can ask about ${either(projects.map((p) => p.name))}.` : NOT_FOUND);
  if ("which" in pick) return { ...none(`Did you mean ${either(pick.which.map((p) => `"${p.name}"`))}? Say it again with its name.`), which: whichOf(pick.which) };
  if ("choose" in pick) return { ...none(`Which project? You can ask about ${either(pick.choose.map((p) => p.name))}.`), which: whichOf(pick.choose) };
  const v = views.find((x) => x.project.id === pick.project.id)!;
  const p = v.project;
  const release = (r: ClientView["releases"][number]) => `${r.name} ${r.done ? "(done)" : `on ${dayDate(r.date)}`}`;
  const releases = v.releases.length
    ? `${v.releases.length === 1 ? "Its release is" : "Its releases are"} ${either(v.releases.map(release), "and")}.`
    : "It has no releases planned yet.";
  // CD56: the status its PM set, only once they shared its reason with the client, in the PM's own words
  const status = v.status ? ` Its status is ${v.status.label.toLowerCase()}: ${v.status.reason.replace(/\.$/, "")}.` : "";
  return none(`${p.name} is ${forWhom(p)}, ${runs(p)}. ${releases}${status}`);
}
