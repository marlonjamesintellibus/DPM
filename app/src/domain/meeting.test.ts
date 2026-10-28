// Phase O: how a meeting note's items split (M33), with no database. Kemar recorded a Forager meeting with Alicia
// and Kyle; Jodian was not there.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "./atlas-checks/kemar-note.fixture";
import type { MeetingContext } from "./atlas-checks/types";
import { mineDraft, splitMeeting } from "./meeting";
import type { ExtractedItemDraft } from "./shared";

const MEETING: MeetingContext = { projectId: "forager", mode: "meeting", attendees: [{ personId: "alicia", name: "Alicia Campbell", inDpm: true }, { personId: "kyle", name: "Kyle", inDpm: false }] };
const base: ExtractedItemDraft = { ordinal: 1, kind: "update", scope: "project", projectId: "forager", routing: "routed", routingReason: "#145", spans: [{ start: 0, end: 5 }], confidence: "high", mark: "pre_accepted", rationale: "" };
const update = (id: string, ordinal: number): ExtractedItemDraft => ({ ...base, ordinal, target: { type: id.startsWith("ms") ? "milestone" : "work_item", id, field: id.startsWith("ms") ? "forecast" : "state", oldValue: "in_progress", newValue: "done" } });
const promise = (personId: string | null, ordinal: number, sure = true, link: ExtractedItemDraft["commitment"] extends infer C ? (C extends { link: infer L } ? L : never) : never = null): ExtractedItemDraft => ({
  ...base,
  ordinal,
  kind: "commitment",
  scope: "personal",
  projectId: null,
  confidence: sure ? "high" : "low",
  commitment: { act: "promise", what: "Send Kyle the buyer list", dueOn: "2026-10-23", dueFrom: "said", dueWords: "Friday", link, commitmentId: null, seenDue: null },
  speaker: { personId, sure },
});
const split = (drafts: ExtractedItemDraft[]) => splitMeeting(drafts, { recorderId: "kemar", meeting: MEETING, projects: KEMAR_CONTEXT.projects });

describe("splitMeeting", () => {
  it("an update to an attendee's record is theirs; the recorder's own record, and one of someone not there, stay the recorder's", () => {
    const parts = split([update("ms-release-1", 1), update("wi-145", 2), update("wi-160", 3)]);
    expect(parts.map((p) => (p.to === "own" ? "own" : `${p.personId}@${p.projectId}`))).toEqual(["alicia@forager", "own", "own"]);
  });

  it("a promise by someone else is about them, on the meeting's project or the record it names (MT8); unsure stays unsure (MT2)", () => {
    const parts = split([promise("alicia", 1), promise(null, 2, false), promise("alicia", 3, true, { type: "work_item", id: "wi-208", projectId: "insights", label: "#208" })]);
    expect(parts).toMatchObject([
      { to: "attributed", kind: "commitment", personId: "alicia", projectId: "forager", sure: true },
      { to: "attributed", personId: null, sure: false },
      { to: "attributed", projectId: "insights" },
    ]);
  });

  it("decisions, risks and the recorder's own promises are never anyone else's: they wait in the recorder's review (reviewDecisions)", () => {
    const decision: ExtractedItemDraft = { ...base, kind: "braid_new", braid: { kind: "decision", title: "Move the refresh", match: "new", matchEntryId: null } };
    const own: ExtractedItemDraft = { ...promise("kemar", 2), speaker: undefined };
    expect(split([decision, own]).map((p) => p.to)).toEqual(["own", "own"]);
  });

  it("only a change the checks found, to a record they are sure of, is asked: no_change and a guessed record stay the recorder's (fix check, 28 Oct)", () => {
    const same: ExtractedItemDraft = { ...update("ms-release-1", 1), mark: "no_change" };
    const guessed: ExtractedItemDraft = { ...update("ms-release-1", 2), mark: "needs_ok", closeMatches: { ids: ["ms-release-1", "wi-145"], chosen: null } };
    const doneWork: ExtractedItemDraft = { ...promise("alicia", 3), mark: "no_change" };
    expect(split([same, guessed, doneWork, update("ms-release-1", 4)]).map((p) => p.to)).toEqual(["own", "own", "own", "attributed"]);
  });

  it("keeps message order", () => {
    expect(split([update("wi-145", 3), promise("alicia", 1)]).map((p) => p.draft.ordinal)).toEqual([1, 3]);
  });
});

describe("mineDraft", () => {
  const project = { id: "forager", name: "Forager 2.0" };
  it("MT1: someone else's promise is a dependency for the project, titled who, what and when, waiting for the recorder's OK", () => {
    const kyles = promise("kyle", 1);
    const [part] = split([{ ...kyles, commitment: { ...kyles.commitment!, what: "Send the feed access" } }]);
    if (part.to !== "attributed") throw new Error("expected attributed");
    expect(mineDraft(part, { recorderId: "kemar", personId: "kyle", name: "Kyle", project })).toMatchObject({
      kind: "braid_new",
      scope: "project",
      projectId: "forager",
      mark: "needs_ok",
      confidence: "medium",
      commitment: undefined,
      braid: { kind: "dependency", title: "Kyle to send the feed access by 23 Oct", match: "new", expectedOn: "2026-10-23" },
    });
  });

  it("the recorder named as the speaker: their own promise again, with no speaker", () => {
    const [part] = split([promise(null, 1, false)]);
    if (part.to !== "attributed") throw new Error("expected attributed");
    const d = mineDraft(part, { recorderId: "kemar", personId: "kemar", name: "Kemar Brown", project });
    expect(d).toMatchObject({ kind: "commitment", routingReason: "Only you see your promises", mark: "needs_ok" });
    expect(d.speaker).toBeUndefined();
  });

  it("an update stays as the checks left it: Save asks its owner (U5)", () => {
    const [part] = split([{ ...update("ms-release-1", 1), ask: { ownerId: "alicia" } }]);
    if (part.to !== "attributed") throw new Error("expected attributed");
    expect(mineDraft(part, { recorderId: "kemar", personId: "alicia", name: "Alicia Campbell", project })).toEqual(part.draft);
  });
});
