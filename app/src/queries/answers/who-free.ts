// Who could pick up a piece of work (conversational plan, phase N): "Who can pick up #151?". The work is
// found as "Who owns ..." finds it (PP5), among the open work on the asker's projects. Then each other
// member of its project, by name, with what phase H's rule lets the asker see of them (CD9,
// queries/people.ts): how many open work items they own on projects the two share, how many of those
// are past due, and their leave where the project shows it (PP7). Facts only (PP6): who should take it
// is never said, the list is by name, and Atlas does not word it. Outside contacts are not teammates.
import type { Conn } from "../../db/conn";
import { followUpRest } from "../../domain/question";
import { asThing, ownedMatches } from "../../domain/topics/people";
import { freePhrase } from "../../domain/topics/who-free";
import { ownedOn, personSeenBy } from "../people";
import { projectReader, todayIn, type ProjectWorkItem } from "../project";
import { placesOf } from "./people";
import { capped, counted, dayDate, projectsAsked, workTitle, type AnswerBuilder, type Body, type DraftCard } from "./shared";

/** No work said, nor a project: what to ask instead. */
export const FREE_FOR_WHAT = "Say which work, for example: Who can pick up #151?";

const none = (text: string): Body => ({ text, cards: [], more: null });

/** CV8: the work the words ask about, newest first: "and #152?" after "Who can pick up #151?" asks about #152. */
function workAsked(words: readonly string[], places: readonly string[]): string | null {
  for (const w of words) {
    const phrase = freePhrase(w);
    if (phrase) return phrase;
    const rest = followUpRest(w, places);
    if (rest) return asThing(rest);
  }
  return null;
}

export const whoFree: AnswerBuilder = async (conn, viewerId, question, now) => {
  const phrase = workAsked([question.asked, ...(question.follows ?? [])], await placesOf(conn, viewerId));
  const views = await projectsAsked(conn, viewerId, question.projectId, now);
  // Only work that is not Done or cancelled can be picked up: what the project shows as someone's (CD9)
  const open = views.flatMap((v) => ownedOn(v).work.map((w) => ({ v, w, title: w.title, number: w.number })));
  if (!phrase) {
    // "Who's free on Forager?": the teammates on the project named, with no one piece of work
    if (question.projectId && views.length === 1) return teammates(conn, viewerId, views[0].project, null, now);
    return none(FREE_FOR_WHAT);
  }
  const found = ownedMatches(phrase, open);
  if (!found.length) return none(`Nothing open on your projects matches "${phrase}". Try its number, for example: Who can pick up #151?`);
  if (found.length > 1) {
    const cards: DraftCard[] = found.map(({ v, w }) => ({ title: workTitle(w), detail: `${v.project.name}: ${w.owner ? w.owner.name : "nobody yet"}`, tag: w.stateLabel, href: `/projects/${v.project.id}` }));
    return { text: `${counted(found.length, "thing", "things")} on your projects match "${phrase}". Ask again with its number.`, ...capped(cards, { label: "matches", href: "/projects" }) };
  }
  const [{ v, w }] = found;
  return teammates(conn, viewerId, v.project, w, now);
};

/**
 * The other members of the project, by name, each with their open and past due work on projects they
 * share with the asker, and their leave where it shows. Not the asker, and not whoever owns the work.
 */
async function teammates(conn: Conn, viewerId: string, project: { id: string; name: string }, work: ProjectWorkItem | null, now: Date): Promise<Body> {
  const { world } = await projectReader(conn, viewerId);
  const today = todayIn(now);
  const ownerId = work?.owner?.id ?? null;
  const ids = world.memberships.filter((m) => m.projectId === project.id && m.state === "member" && m.personId !== viewerId && m.personId !== ownerId).map((m) => m.personId);
  const lead = work
    ? `${workTitle(work)} on ${project.name} is ${ownerId === viewerId ? "yours" : work.owner ? `${work.owner.name}'s` : "nobody's yet"}.`
    : null;
  const cards: DraftCard[] = [];
  for (const id of ids) {
    // Phase H's rule: only what the two share (CD9); they are on this project, so they share it
    const seen = await personSeenBy(conn, viewerId, id, now);
    if (!seen) continue;
    const late = seen.work.filter(({ w }) => !!w.dueDate && w.dueDate < today).length;
    cards.push({
      title: seen.person.name,
      detail: [
        counted(seen.work.length, "open work item", "open work items"),
        late ? `${late} past due` : "none past due",
        seen.onLeaveUntil ? `on leave until ${dayDate(seen.onLeaveUntil)}` : null,
      ]
        .filter(Boolean)
        .join(", "),
      tag: `On ${project.name}`,
      href: `/projects/${project.id}`,
    });
  }
  cards.sort((a, b) => a.title.localeCompare(b.title));
  const besides = work?.owner && ownerId !== viewerId ? `${work.owner.name} and you` : "you";
  if (!cards.length) return none([lead, `Nobody else is on ${project.name} besides ${besides}.`].filter(Boolean).join(" "));
  const each = `${counted(cards.length, "other person is", "other people are")} on ${project.name} besides ${besides}; each line shows the open work they own on projects you share.`;
  return { text: [lead, each].filter(Boolean).join(" "), ...capped(cards, { label: `on ${project.name}`, href: `/projects/${project.id}` }) };
}
