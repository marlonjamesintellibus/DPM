// Phase L, M31: what a correction proposed, as its proposals stand now (they were made while the message
// was read, commands/capture.ts). Each part says who decides it (UN8: only a proposal), that it was refused
// because the word already names another project the asker can open (UN9, nothing else is named), or that
// nothing needed changing. Said again, it tells how the first one stands (rule 6).
import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../../db/conn";
import * as t from "../../db/schema";
import { vocabularyKey, type VocabularyChangeRecord } from "../../domain/machines/vocabulary-change";
import type { AnswerCard } from "../../domain/question";
import type { Correction } from "../../domain/topics/correction";
import { firstName, projectReader, shortDate } from "../project";
import type { AnswerBuilder } from "./shared";

const HOW = 'I couldn\'t tell what to change. Say it like "GQ also means the Guild" or "Kyle is Store Insights, not Forager".';

/** The changes a correction proposes: the project it is about, and the one it is not, if said. */
export function correctionParts(c: Correction): Pick<VocabularyChangeRecord, "projectId" | "kind" | "word" | "personId" | "remove">[] {
  return [
    { projectId: c.projectId, kind: c.kind, word: c.word, personId: c.personId, remove: false },
    ...(c.notProjectId ? [{ projectId: c.notProjectId, kind: c.kind, word: c.word, personId: c.personId, remove: true }] : []),
  ];
}

/** What a change says, for a sentence: `"Guild" as a name for GQ & Academy`, `Kyle as a contact on Store Insights`. */
export async function changeLabel(conn: Conn, c: Pick<VocabularyChangeRecord, "kind" | "word" | "personId" | "remove" | "projectId">): Promise<string> {
  const [p] = await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, c.projectId));
  if (c.kind === "alias") return c.remove ? `"${c.word}" no longer a name for ${p.name}` : `"${c.word}" as a name for ${p.name}`;
  const [who] = c.personId ? await conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, c.personId)) : [];
  return c.remove ? `${who?.name ?? "them"} off ${p.name}'s contacts` : `${who?.name ?? "them"} as a contact on ${p.name}`;
}

export const correction: AnswerBuilder = async (conn, viewerId, question) => {
  if (!question.correction) return { text: HOW, cards: [], more: null };
  const reader = await projectReader(conn, viewerId);
  const sentences: string[] = [];
  const cards: AnswerCard[] = [];
  for (const part of correctionParts(question.correction)) {
    if (!reader.mayRead(part.projectId)) continue;
    const [project] = await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, part.projectId));
    const [row] = await conn.select().from(t.vocabularyChanges).where(eq(t.vocabularyChanges.dedupKey, vocabularyKey(part)));
    // Said again in other words or case, it is the first one, as it was first said
    const what = await changeLabel(conn, row ?? part);
    const href = `/projects/${part.projectId}`;
    if (!row) {
      sentences.push(part.remove ? `${project.name} doesn't have that, so there's nothing to take off.` : `That's already how I read ${project.name}.`);
      continue;
    }
    switch (row.state) {
      case "proposed": {
        const deciders = await conn
          .select({ name: t.people.name })
          .from(t.projectMemberships)
          .innerJoin(t.people, eq(t.people.id, t.projectMemberships.personId))
          .where(and(eq(t.projectMemberships.projectId, part.projectId), eq(t.projectMemberships.state, "member"), inArray(t.projectMemberships.role, ["pm", "lead"])));
        const who = deciders.length ? deciders.map((d) => firstName(d.name)).sort().join(" or ") : `a PM or Lead of ${project.name}`;
        sentences.push(`I asked ${who} to approve ${what}. Until then I read it as before.`);
        cards.push({ title: what.charAt(0).toUpperCase() + what.slice(1), detail: `Waiting for ${who}`, tag: "Proposed", href });
        break;
      }
      case "refused": {
        // UN9: the clash was found among projects they could open; say only those they can open now
        const names = row.clashesWith.filter(reader.mayRead);
        const clash = names.length ? (await conn.select({ name: t.projects.name }).from(t.projects).where(inArray(t.projects.id, names))).map((p) => p.name).join(" and ") : "another project";
        sentences.push(`"${part.word}" already names ${clash}, so I didn't ask: it would make it unclear where updates go.`);
        break;
      }
      case "applied":
        sentences.push(`That's already how I read it: ${what}.`);
        break;
      case "declined": {
        const [by] = row.decidedBy ? await conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, row.decidedBy)) : [];
        sentences.push(`${by ? firstName(by.name) : "A PM"} declined ${what}${row.decidedOn ? ` on ${shortDate(row.decidedOn)}` : ""}.`);
        break;
      }
      default:
        sentences.push(`Nobody answered ${what} in time, so it lapsed.`);
    }
  }
  return { text: sentences.join(" ") || HOW, cards, more: null };
};
