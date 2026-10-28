// Phase O, meetings (conversational plan, section 17): how a meeting note's items split (M33 split), with no
// database. What passed the server checks is the recorder's own (their review, M3), or about an attendee (M34):
// an update to a record an attendee owns, or a promise someone else made (rule 10). Decisions and every other
// item stay in the recorder's review, so a decision is confirmed there before it reaches the deciders (the model's
// fix reviewDecisions, M15). Which state an attendee's item takes (held, waiting, proposed or mine) is M34's
// SPLIT; what an item that becomes the recorder's own looks like in their review is mineDraft.
import type { CandidateProject, MeetingContext } from "./atlas-checks/types";
import type { AttributedKind } from "./machines/attributed-item";
import { lowerTo, type ExtractedItemDraft } from "./shared";
import type { IsoDate } from "./dates";

export type SplitPart =
  | { to: "own"; draft: ExtractedItemDraft }
  | {
      to: "attributed";
      draft: ExtractedItemDraft;
      kind: AttributedKind;
      /** Whose it is; null when Atlas could not say who made the promise (MT2). */
      personId: string | null;
      /** MT8: the item's own project. A promise's is the record it names, else the meeting's. */
      projectId: string;
      sure: boolean;
    };

/**
 * Each item, in message order: the recorder's own, or about someone else. An update is about the record's owner
 * when they were there (an attendee) and are not the recorder; one about someone who was not there stays the
 * recorder's, and Save asks its owner as for any update (U5, MT3). A promise is about whoever made it (CD5).
 * Only a change the checks found, to a record they are sure of, is asked of anyone (fix check, 28 Oct): an update
 * that changes nothing (no_change) is not news to its owner, and one whose record Atlas only guessed (Phase D,
 * closeMatches) stays in the recorder's review, where they say which record was meant; Save then asks whoever
 * owns that one (U5). A promise about work already done (no_change) asks nothing either.
 */
export function splitMeeting(drafts: readonly ExtractedItemDraft[], ctx: { recorderId: string; meeting: MeetingContext; projects: readonly CandidateProject[] }): SplitPart[] {
  const attended = new Set(ctx.meeting.attendees.map((a) => a.personId));
  const ownerOf = (id: string) => ctx.projects.flatMap((p) => p.records).find((r) => r.id === id)?.ownerId ?? null;
  return [...drafts]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((draft): SplitPart => {
      if (draft.mark === "no_change" || draft.closeMatches) return { to: "own", draft };
      if (draft.kind === "commitment" && draft.speaker && draft.commitment?.act === "promise") {
        const link = draft.commitment.link;
        const projectId = link && ctx.projects.some((p) => p.id === link.projectId) ? link.projectId : ctx.meeting.projectId;
        return { to: "attributed", draft, kind: "commitment", personId: draft.speaker.personId, projectId, sure: draft.speaker.sure };
      }
      const t = draft.target;
      if (draft.kind === "update" && t && t.type !== "leave" && draft.projectId) {
        const owner = ownerOf(t.id);
        if (owner && owner !== ctx.recorderId && attended.has(owner)) return { to: "attributed", draft, kind: "update", personId: owner, projectId: draft.projectId, sure: true };
      }
      return { to: "own", draft };
    });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: IsoDate) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const lowerFirst = (s: string) => (s.length > 1 && s[1] !== s[1].toUpperCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * What an item about someone else looks like once it is the recorder's own (M34 mine): from own notes (CD17), or
 * about someone not asked (MT1). A promise by the recorder (named when fixing an unsure speaker) is their own
 * promise again. Someone else's promise becomes a dependency for the project, titled with who, what and when as
 * U2 titles one ("Kyle to send the feed access by 22 Oct"), waiting for the recorder's OK: a project waits on it,
 * and nothing is filed as theirs (NothingFiledAsKyles). An update stays as the checks left it: Save asks its owner
 * (U5) or applies it, as for any update.
 */
export function mineDraft(
  part: Extract<SplitPart, { to: "attributed" }>,
  ctx: { recorderId: string; personId: string | null; name: string | null; project: { id: string; name: string } },
): ExtractedItemDraft {
  const { draft } = part;
  if (part.kind === "update") return draft;
  const { speaker: _speaker, ...rest } = draft;
  const promise = draft.commitment!;
  const someoneElse = ctx.personId !== null && ctx.personId !== ctx.recorderId && ctx.name !== null;
  if (!someoneElse || !promise.dueOn) {
    // The recorder's own (or nobody named, in their own notes): their promise, for them to keep or reject
    return { ...rest, routingReason: "Only you see your promises", mark: "needs_ok" };
  }
  const first = ctx.name!.split(" ")[0];
  const title = `${first} to ${lowerFirst(promise.what)} by ${day(promise.dueOn)}`;
  return {
    ...rest,
    kind: "braid_new",
    scope: "project",
    projectId: ctx.project.id,
    routing: "routed",
    routingReason: `${first}'s promise from the meeting; ${ctx.project.name} waits on it`,
    confidence: lowerTo(draft.confidence, "medium"),
    mark: "needs_ok",
    commitment: undefined,
    braid: { kind: "dependency", title, match: "new", matchEntryId: null, expectedOn: promise.dueOn },
  };
}
