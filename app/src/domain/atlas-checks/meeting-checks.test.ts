// Phase O: the server checks on a meeting note's promises (conversational plan, section 17, MT1 to MT3, CD5).
// Kemar recorded a Forager meeting with Alicia and Kyle. Someone else's promise is theirs (rule 10): it passes
// the checks only in a meeting note, says whose it is, and never matches Kemar's own commitments (CD3).
import { describe, expect, it } from "vitest";
import type { ExtractedItemDraft } from "../shared";
import { runChecks } from "./checks";
import { KEMAR_CONTEXT } from "./kemar-note.fixture";
import type { CheckContext, MeetingContext, RawProposal } from "./types";

const MEETING: MeetingContext = {
  projectId: "forager",
  mode: "meeting",
  attendees: [
    { personId: "alicia", name: "Alicia Campbell", inDpm: true },
    { personId: "kyle", name: "Kyle", inDpm: false },
  ],
};

const promise = (quote: string, p: Partial<RawProposal> = {}): RawProposal => ({
  kind: "commitment",
  projectId: null,
  routingReason: { basis: "personal", evidence: "Alicia", label: "Alicia's promise" },
  newValue: "promised",
  promise: "Send Kyle the buyer list",
  speakerId: "alicia",
  quote,
  confidence: "high",
  rationale: "Alicia promised it in the meeting",
  ...p,
});

const read = (p: RawProposal, extra: Partial<CheckContext> = { meeting: MEETING }) => {
  const r = runChecks([p], { ...KEMAR_CONTEXT, text: `${p.quote}.`, commitments: [{ id: "cm-1", what: "Send Kyle the buyer list", dueOn: "2026-10-23", state: "open", linkId: null }], ...extra });
  return { item: r.items[0] as ExtractedItemDraft | undefined, dropped: r.dropped[0] };
};

describe("a meeting note's promises (phase O)", () => {
  it("CD5 holds outside a meeting: Alicia's promise in Kemar's own update is refused, whatever Atlas says", () => {
    expect(read(promise("Alicia will send Kyle the buyer list Friday"), {}).dropped).toMatchObject({ check: 11, reason: "that is someone else's promise; it is theirs to keep" });
  });

  it("in a meeting, an attendee's promise passes as theirs, with its day read by the server, and matches none of Kemar's (CD3)", () => {
    const { item } = read(promise("Alicia will send Kyle the buyer list Friday"));
    expect(item).toMatchObject({ kind: "commitment", scope: "personal", routingReason: "Alicia Campbell's promise, from the meeting", speaker: { personId: "alicia", sure: true } });
    expect(item?.commitment).toMatchObject({ act: "promise", what: "Send Kyle the buyer list", dueOn: "2026-10-23", commitmentId: null });
  });

  it("someone else's promise is never said done for Kemar's commitments", () => {
    expect(read(promise("Alicia sent Kyle the buyer list", { newValue: "done", commitmentId: "cm-1" })).dropped).toMatchObject({ check: 1 });
  });

  it("MT2: Atlas unsure who said it: kept at low confidence, with nobody named until the recorder says", () => {
    const { item } = read(promise("Someone will send Kyle the buyer list Friday", { speakerId: "alicia", speakerSure: false }));
    expect(item).toMatchObject({ confidence: "low", routingReason: "Who said this?", speaker: { personId: "alicia", sure: false } });
    const nobody = read(promise("Someone will send Kyle the buyer list Friday", { speakerId: "marcus", speakerSure: false })).item;
    expect(nobody?.speaker).toEqual({ personId: null, sure: false });
  });

  it("a speaker who is no one in the meeting or on Kemar's projects is refused, and not named (P10)", () => {
    expect(read(promise("Marcus will send Kyle the buyer list Friday", { speakerId: "marcus" })).dropped).toMatchObject({ check: 1, reason: "that is not someone in the meeting" });
  });

  it("MT1: Kyle, not in DPM, passes as his own promise; DPM makes it a dependency when it splits the note", () => {
    expect(read(promise("Kyle will send the feed access Thursday", { speakerId: "kyle", promise: "Send the feed access" })).item?.speaker).toEqual({ personId: "kyle", sure: true });
  });

  it("CM3 for an attendee: Alicia finishing her own milestone by a day is its forecast, asked of her (U5)", () => {
    const { item } = read(promise("Alicia will have Release 1 done by Friday", { targetId: "ms-release-1", promise: "Finish Release 1" }));
    expect(item).toMatchObject({ kind: "update", target: { id: "ms-release-1", field: "forecast", newValue: "2026-10-23" }, ask: { ownerId: "alicia" } });
  });

  it("the author's own promise in a meeting is theirs, as in any update", () => {
    const { item } = read(promise("I'll send Kyle the access request tomorrow", { speakerId: "kemar", promise: "Send Kyle the access request" }));
    expect(item).toMatchObject({ routingReason: "Only you see your promises" });
    expect(item?.speaker).toBeUndefined();
  });

  it("speakerId means nothing outside a meeting note", () => {
    const { item } = read(promise("I'll send Kyle the access request tomorrow", { speakerId: "alicia", promise: "Send Kyle the access request" }), {});
    expect(item?.speaker).toBeUndefined();
  });
});
