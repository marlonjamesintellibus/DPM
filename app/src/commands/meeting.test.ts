// Phase O against PGlite (conversational plan, section 17; research model meeting.mjs, its six fixes): M33 Meeting
// capture and M34 Attributed item, with MT1 to MT12. Kemar records a Forager meeting at 9:10am on Tuesday 20 Oct.
// Alicia is Forager's PM, Jodian a member, Kyle (Sprouts IT) its contact and not in DPM, and Andre is not on
// Forager. Kemar is on leave Mon 26 to Fri 30 Oct. Something said about someone changes nothing of theirs until
// they confirm it (rule 10); until phase F an Ask is a notice in their chat plus an inbox item.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { config } from "../domain/config";
import { getChatSummary, getThread } from "../queries/chat";
import { getInbox } from "../queries/inbox";
import { describeAttributed, heldForReview } from "../queries/meeting";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { createFixtureExtractor, MEETING_NOTE } from "../atlas/fixture";
import type { Extractor } from "../atlas/extractor";
import type { CheckContext } from "../domain/atlas-checks/types";
import { capturesToRead, readCapture } from "./atlas";
import { beginRead, decideExtraction, discardCapture, openReview, proposeItems, runCaptureTimers, saveCapture } from "./capture";
import { confirmAttendees, confirmAttributed, createMeetingNote, declineAttributed, editAttributed, fixSpeaker, readAsOwnNotes, runMeetingTimers, withdrawOnLeave } from "./meeting";
import { undoSave } from "./undo";

let db: Db;
let n = 0;
const DAY = 24 * 60;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const timers = (minutes: number) => runMeetingTimers({ db, now: at(minutes) });
const item = async (id: string) => (await db.select().from(t.attributedItems).where(eq(t.attributedItems.id, id)))[0];
const meetingRow = async (id: string) => (await db.select().from(t.meetings).where(eq(t.meetings.id, id)))[0];
const capture = async (id: string) => (await db.select().from(t.captures).where(eq(t.captures.id, id)))[0];
const notices = async (who: string) => (await db.select().from(t.notices).where(eq(t.notices.personId, who))).map((x) => x.text);
const asks = async (who: string) => (await db.select().from(t.inboxItems).where(and(eq(t.inboxItems.ownerId, who), eq(t.inboxItems.state, "open")))).map((i) => i.causeKey).filter((k) => k.startsWith("attributed:"));
const leave = (projectId: string, personId: string) => db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, projectId), eq(t.projectMemberships.personId, personId)));

const TEXT =
  "Finished #145 today. Alicia: I'll send Kyle the buyer list Friday. Jodian finished the backfill #160. Kyle will send the feed access Thursday. On Forager we agreed to move the daily refresh to 6am. Someone will update the runbook tomorrow.";

const OWN: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#145", label: "#145" }, targetId: "wi-145", field: "state", newValue: "done", quote: "Finished #145 today", confidence: "high", rationale: "You finished it." };
const promiseBy = (speakerId: string | null, quote: string, promise: string, extra: Partial<RawProposal> = {}): RawProposal => ({
  kind: "commitment",
  projectId: null,
  routingReason: { basis: "personal", evidence: "I'll", label: "Promise" },
  newValue: "promised",
  promise,
  speakerId,
  quote,
  confidence: "high",
  rationale: "A promise made in the meeting.",
  ...extra,
});
const ALICIA = promiseBy("alicia", "Alicia: I'll send Kyle the buyer list Friday", "Send Kyle the buyer list");
const JODIAN: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#160", label: "#160" }, targetId: "wi-160", field: "state", newValue: "done", quote: "Jodian finished the backfill #160", confidence: "high", rationale: "Jodian finished it." };
const KYLE = promiseBy("kyle", "Kyle will send the feed access Thursday", "Send the feed access");
const DECISION: RawProposal = {
  kind: "braid_new",
  projectId: "forager",
  routingReason: { basis: "reference", evidence: "Forager", label: "On Forager" },
  braidKind: "decision",
  braidTitle: "Move the daily refresh to 6am",
  quote: "On Forager we agreed to move the daily refresh to 6am",
  confidence: "high",
  rationale: "Agreed in the meeting.",
};
const UNSURE = promiseBy(null, "Someone will update the runbook tomorrow", "Update the runbook", { speakerSure: false });
const ALL = [OWN, ALICIA, JODIAN, KYLE, DECISION, UNSURE];

type Options = { by?: string; text?: string; attendees?: string[]; own?: boolean; minutes?: number; merge?: boolean; project?: string };
/** The recorder sends a meeting note, says who was there, and Atlas's recorded read is stored. */
async function meet(proposals: readonly RawProposal[], o: Options = {}) {
  const by = o.by ?? "kemar";
  const minutes = o.minutes ?? 0;
  const created = await createMeetingNote(as(by, minutes), { text: o.text ?? TEXT, projectId: o.project ?? "forager", messageId: `mtg-${++n}` });
  if (o.own) await readAsOwnNotes(as(by, minutes), created.meetingId);
  else await confirmAttendees(as(by, minutes), created.meetingId, { attendees: o.attendees ?? ["alicia", "jodian", "kyle"], told: true, merge: o.merge });
  const proposed = await proposeItems(as(by, minutes), created.captureId, proposals);
  return { ...created, proposed, att: (ordinalOf: RawProposal) => `att-${created.captureId}-${proposals.indexOf(ordinalOf) + 1}` };
}

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("M33: a meeting note waits for who was there (MT3, MT4)", () => {
  it("is Kemar's message, and nothing reads it until he says who was there; its read never starts on its own", async () => {
    const { captureId, meetingId } = await createMeetingNote(as("kemar"), { text: TEXT, projectId: "forager", messageId: "m-1" });
    expect(await meetingRow(meetingId)).toMatchObject({ state: "received", mode: null, recorderId: "kemar", projectId: "forager" });
    expect(await capturesToRead(db)).not.toContain(captureId);
    await expect(beginRead(as("kemar"), captureId)).rejects.toThrow("a meeting note waits for its attendees");
    // The chat card offers Forager's members and contact, never Kemar himself
    const thread = await getThread(db, "kemar", (await capture(captureId)).conversationId!, at(0));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].meeting).toMatchObject({ state: "received", project: { name: "Forager 2.0" }, merge: null });
    expect(thread.turns[0].meeting!.candidates.map((c) => c.id)).toEqual(["alicia", "jodian", "kyle"]);
  });

  it("P10: only a project the recorder reads; anyone else's note reads as not found", async () => {
    await expect(createMeetingNote(as("alicia"), { text: TEXT, projectId: "insights", messageId: "m-2" })).rejects.toThrow("choose one of your projects");
    const { meetingId } = await createMeetingNote(as("kemar"), { text: TEXT, projectId: "forager", messageId: "m-3" });
    await expect(confirmAttendees(as("alicia"), meetingId, { attendees: ["jodian"], told: true })).rejects.toMatchObject({ code: "not_found" });
  });

  it("MT4: attendees who were not told are never read as theirs; MT3: Andre, not on Forager, cannot be named as there", async () => {
    const { meetingId } = await createMeetingNote(as("kemar"), { text: TEXT, projectId: "forager", messageId: "m-4" });
    await expect(confirmAttendees(as("kemar"), meetingId, { attendees: ["alicia"], told: false })).rejects.toThrow("own notes");
    await expect(confirmAttendees(as("kemar"), meetingId, { attendees: ["andre"], told: true })).rejects.toThrow("on the project or one of its contacts");
    expect((await meetingRow(meetingId)).state).toBe("received");
  });

  it("a note never confirmed expires after reviewExpiryDays with its capture, and Kemar is told; nothing was read (rule 5)", async () => {
    const { captureId, meetingId } = await createMeetingNote(as("kemar"), { text: TEXT, projectId: "forager", messageId: "m-5" });
    await timers((config.reviewExpiryDays - 1) * DAY);
    expect((await meetingRow(meetingId)).state).toBe("received");
    await timers(config.reviewExpiryDays * DAY);
    expect((await meetingRow(meetingId)).state).toBe("expired");
    expect((await capture(captureId)).state).toBe("expired");
    expect(await notices("kemar")).toEqual([expect.stringContaining("Your meeting note from 9:10am was not read: nobody confirmed who was there")]);
    expect(await db.select().from(t.extractions).where(eq(t.extractions.captureId, captureId))).toEqual([]);
  });
});

describe("M33 read: once the attendees are confirmed, Atlas reads it with them", () => {
  it("the read is given who was there, and nothing earlier in the chat; a question said in the meeting asks Atlas nothing", async () => {
    const { captureId, meetingId, conversationId } = await createMeetingNote(as("kemar"), { text: MEETING_NOTE, projectId: "forager", messageId: "m-read" });
    await confirmAttendees(as("kemar"), meetingId, { attendees: ["alicia"], told: true });
    expect(await capturesToRead(db)).toContain(captureId);
    let seen: CheckContext | null = null;
    const recorded = createFixtureExtractor();
    const extractor: Extractor = {
      name: "spy",
      async extract(ctx, o) {
        seen = ctx;
        const r = await recorded.extract(ctx, o);
        return { ...r, question: { asked: "What's blocked?", topic: "blocked", projectId: null } };
      },
    };
    const read = await readCapture(as("kemar"), captureId, extractor, { retryDelayMs: () => 0 });
    expect(seen!.meeting).toEqual({ projectId: "forager", mode: "meeting", attendees: [{ personId: "alicia", name: "Alicia Campbell", inDpm: true }] });
    expect(seen!.earlier).toBeUndefined();
    expect(read).toMatchObject({ outcome: "proposed", state: "nothing_to_update" });
    expect((await capture(captureId)).question).toBeNull();
    expect(await asks("alicia")).toHaveLength(1);
    // The chat shows it with Alicia's part, not "Nothing in this one changes a project"
    const thread = await getThread(db, "kemar", conversationId!, at(1));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].meeting).toMatchObject({ state: "split", mode: "meeting", parts: [{ who: "Alicia", title: "Send Kyle the buyer list, by Fri 23 Oct", outcome: "Sent to Alicia to confirm." }] });
  });

  it("M33 READ_FAILED: a note Atlas could not read fails with its meeting (rule 5)", async () => {
    const { captureId, meetingId } = await createMeetingNote(as("kemar"), { text: "No recording of this one.", projectId: "forager", messageId: "m-fail" });
    await readAsOwnNotes(as("kemar"), meetingId);
    await readCapture(as("kemar"), captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
    expect((await capture(captureId)).state).toBe("failed");
    expect((await meetingRow(meetingId)).state).toBe("failed");
  });
});

describe("M33 split: each part goes where it belongs", () => {
  it("Kemar's own work, Kyle's promise (MT1) and the decision wait in his review; Alicia's promise and Jodian's work go to them; the unsure one is held (MT2)", async () => {
    const m = await meet(ALL);
    expect((await meetingRow(m.meetingId)).state).toBe("split");
    const review = await getReview(db, "kemar", m.captureId);
    if (!review.found) throw new Error("no review");
    expect(review.items.map((i) => [i.kindLabel, i.title])).toEqual([
      ["Update", expect.stringContaining("Google Trends connector")],
      ["BRAID · Dependency", "Kyle to send the feed access by 22 Oct"],
      ["BRAID · Decision", "Move the daily refresh to 6am"],
    ]);
    // MT1: nothing is filed as Kyle's; his promise is a dependency for the project, waiting for Kemar's OK
    expect(await item(m.att(KYLE))).toMatchObject({ state: "mine", personId: "kyle" });
    expect(await item(m.att(ALICIA))).toMatchObject({ state: "proposed", personId: "alicia", projectId: "forager", askedOn: "2026-10-20" });
    expect(await item(m.att(JODIAN))).toMatchObject({ state: "proposed", personId: "jodian", kind: "update" });
    // MT2: held in Kemar's review until he says who; Save waits for it
    expect(await item(m.att(UNSURE))).toMatchObject({ state: "held", personId: null });
    expect(review.held).toEqual([{ id: m.att(UNSURE), quote: "Someone will update the runbook tomorrow", title: "Update the runbook, by Wed 21 Oct", choices: [{ id: "kemar", name: "Me" }, { id: "alicia", name: "Alicia Campbell" }, { id: "jodian", name: "Jodian Taylor" }, { id: "kyle", name: "Kyle" }] }]);
    expect(review.canSave).toBe(false);
    // Each attendee is asked: an inbox item and a notice in their chat (no phase F yet)
    expect(await asks("alicia")).toEqual([`attributed:${m.att(ALICIA)}`]);
    expect(await notices("alicia")).toEqual(["Kemar's meeting note on Forager 2.0 says this is yours: Send Kyle the buyer list, by Fri 23 Oct. Is that right? Confirm or decline it in your inbox."]);
    expect(await notices("jodian")).toEqual(["Kemar's meeting note on Forager 2.0 says this is yours: #160 Feature store backfill: In progress to Done. Is that right? Confirm or decline it in your inbox."]);
    // Nothing of theirs changed yet (rule 10)
    expect((await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-160")))[0].state).toBe("in_progress");
    expect(await db.select().from(t.commitments).where(eq(t.commitments.ownerId, "alicia"))).toEqual([]);
  });

  it("Save waits for who said the held item; Kemar's own save never confirms anything about Alicia (YourWordOnlyYours)", async () => {
    const m = await meet(ALL);
    await openReview(as("kemar"), m.captureId);
    for (const i of m.proposed.items) if (i.state === "needs_ok") await decideExtraction(as("kemar"), i.id, { type: "accept" });
    await expect(saveCapture(as("kemar"), m.captureId)).rejects.toThrow("1 needs who said it before this is saved");
    await fixSpeaker(as("kemar"), m.att(UNSURE), "kemar");
    // His own promise joins his review, as any item
    const review = await getReview(db, "kemar", m.captureId);
    if (!review.found) throw new Error("no review");
    expect(review.held).toEqual([]);
    const runbook = review.items.find((i) => i.title === "Update the runbook")!;
    expect(runbook).toMatchObject({ kindLabel: "Promise", state: "needs_ok" });
    await decideExtraction(as("kemar"), runbook.id, { type: "accept" });
    expect(await saveCapture(as("kemar"), m.captureId)).toMatchObject({ outcome: "saved" });
    expect((await item(m.att(ALICIA))).state).toBe("proposed");
    expect(await db.select().from(t.commitments).where(eq(t.commitments.ownerId, "alicia"))).toEqual([]);
    // MT6, M15: the decision is the recorder's report, proposed to the deciders as any decision; never approved by the meeting
    const [decision] = await db.select().from(t.braidEntries).where(eq(t.braidEntries.title, "Move the daily refresh to 6am"));
    expect(decision).toMatchObject({ kind: "decision", state: "proposed", reportedBy: "kemar" });
  });

  it("MT2: only the recorder says who, only someone who was there, and only while the review is open", async () => {
    const m = await meet(ALL);
    await expect(fixSpeaker(as("alicia"), m.att(UNSURE), "alicia")).rejects.toMatchObject({ code: "not_found" });
    await expect(fixSpeaker(as("kemar"), m.att(UNSURE), "andre")).rejects.toThrow("someone who was there: on the project, or one of its contacts");
    await fixSpeaker(as("kemar"), m.att(UNSURE), "jodian");
    expect(await item(m.att(UNSURE))).toMatchObject({ state: "proposed", personId: "jodian" });
    expect(await asks("jodian")).toHaveLength(2);
    const other = await meet([UNSURE], { text: "Someone will update the runbook tomorrow." });
    await discardCapture(as("kemar"), other.captureId);
    expect(await item(other.att(UNSURE))).toMatchObject({ state: "withdrawn", reason: "the note was discarded" });
    await expect(fixSpeaker(as("kemar"), other.att(UNSURE), "jodian")).rejects.toThrow();
  });

  it("MT2: a held item ends with the review when it expires, and nothing of it reached anyone", async () => {
    const m = await meet([UNSURE], { text: "Someone will update the runbook tomorrow." });
    // The reminder first, then the expiry (ReminderBeforeExpiry)
    await runCaptureTimers({ db, now: at(DAY) });
    await runCaptureTimers({ db, now: at(config.reviewExpiryDays * DAY) });
    expect((await capture(m.captureId)).state).toBe("expired");
    expect(await item(m.att(UNSURE))).toMatchObject({ state: "expired" });
    expect((await meetingRow(m.meetingId)).state).toBe("done");
  });

  it("CD17: read as Kemar's own notes, nothing goes to anyone: Alicia's promise is a dependency in his review", async () => {
    const m = await meet([OWN, ALICIA, JODIAN], { own: true, text: "Finished #145 today. Alicia: I'll send Kyle the buyer list Friday. Jodian finished the backfill #160." });
    expect((await meetingRow(m.meetingId)).mode).toBe("own");
    expect(await item(m.att(ALICIA))).toMatchObject({ state: "mine" });
    // Nobody was named as there: Jodian's work is Kemar's own update about her record, asked of her only if he saves it (U5)
    expect(await item(m.att(JODIAN))).toBeUndefined();
    const review = await getReview(db, "kemar", m.captureId);
    if (!review.found) throw new Error("no review");
    expect(review.items.map((i) => [i.title, i.change])).toEqual([
      [expect.stringContaining("Google Trends connector"), expect.anything()],
      ["Alicia to send Kyle the buyer list by 23 Oct", expect.anything()],
      [expect.stringContaining("Feature store backfill"), expect.stringContaining("Ask Jodian")],
    ]);
    expect(await asks("alicia")).toEqual([]);
    expect(await notices("alicia")).toEqual([]);
    expect(await notices("jodian")).toEqual([]);
  });

  it("MT3: Jodian is named but was not there: nothing is sent to her; her promise is a dependency in Kemar's review", async () => {
    const JODIAN_PROMISE = promiseBy("jodian", "Jodian will send the runbook Friday", "Send the runbook");
    const m = await meet([JODIAN_PROMISE], { text: "Jodian will send the runbook Friday.", attendees: ["alicia"] });
    expect(await item(m.att(JODIAN_PROMISE))).toMatchObject({ state: "mine", personId: "jodian" });
    expect(await asks("jodian")).toEqual([]);
    expect(await notices("jodian")).toEqual([]);
    const review = await getReview(db, "kemar", m.captureId);
    if (!review.found) throw new Error("no review");
    expect(review.items.map((i) => i.title)).toEqual(["Jodian to send the runbook by 23 Oct"]);
  });

  it("MT3: the recorder may name someone on the project they did not list, which adds them: it goes to them", async () => {
    const m = await meet([UNSURE], { text: "Someone will update the runbook tomorrow.", attendees: ["alicia"] });
    expect((await heldForReview(db, m.captureId, "kemar"))[0].choices).toEqual([
      { id: "kemar", name: "Me" },
      { id: "alicia", name: "Alicia Campbell" },
      { id: "jodian", name: "Jodian Taylor (not listed as there)" },
      { id: "kyle", name: "Kyle (not listed as there)" },
    ]);
    await fixSpeaker(as("kemar"), m.att(UNSURE), "jodian");
    expect(await item(m.att(UNSURE))).toMatchObject({ state: "proposed", personId: "jodian" });
    expect(await asks("jodian")).toEqual([`attributed:${m.att(UNSURE)}`]);
    const [fixed] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, m.att(UNSURE)), eq(t.auditEntries.action, "FIX_SPEAKER")));
    expect(fixed.detail).toMatchObject({ added: true });
  });

  it("M33 split: an update that changes nothing asks nobody; it stays in Kemar's review as no change", async () => {
    const STILL: RawProposal = { ...JODIAN, newValue: "in_progress", quote: "Jodian is still on the backfill #160", rationale: "Still going." };
    const m = await meet([STILL], { text: "Jodian is still on the backfill #160." });
    expect(await item(m.att(STILL))).toBeUndefined();
    expect(m.proposed.items).toEqual([expect.objectContaining({ state: "no_change" })]);
    expect(await asks("jodian")).toEqual([]);
    expect(await notices("jodian")).toEqual([]);
  });

  it("M33 split: a record Atlas only guessed is not asked of its owner; it waits in Kemar's review for him to say which", async () => {
    const GUESS: RawProposal = { ...JODIAN, targetOptions: ["wi-145"] };
    const m = await meet([GUESS], { text: "Jodian finished the backfill #160." });
    expect(await item(m.att(GUESS))).toBeUndefined();
    expect(await asks("jodian")).toEqual([]);
    expect(await notices("jodian")).toEqual([]);
    const review = await getReview(db, "kemar", m.captureId);
    if (!review.found) throw new Error("no review");
    expect(review.items).toEqual([expect.objectContaining({ state: "needs_ok" })]);
  });

  it("MT8: an item about another project is routed there, and an attendee is asked only on the item's own project", async () => {
    const text = "Finished #208 for Store Insights. Alicia: I'll send Kyle the buyer list Friday.";
    const EXPORT: RawProposal = { ...OWN, projectId: "insights", targetId: "wi-208", routingReason: { basis: "target", evidence: "#208", label: "#208" }, quote: "Finished #208 for Store Insights" };
    const m = await meet([EXPORT, ALICIA], { text, attendees: ["alicia"] });
    const review = await getReview(db, "kemar", m.captureId);
    if (!review.found) throw new Error("no review");
    expect(review.groups.map((g) => g.label)).toEqual(["Store Insights"]);
    expect(await item(m.att(ALICIA))).toMatchObject({ projectId: "forager", state: "proposed" });
  });

  it("MT11: a long meeting is capped as a long update is (E7): the rest is more found, nothing is lost silently", async () => {
    const lines = Array.from({ length: config.maxProposalsPerCapture + 2 }, (_, i) => `Risk number ${i + 1} is the vendor ${i + 1}`);
    const risks: RawProposal[] = lines.map((q, i) => ({ ...DECISION, braidKind: "risk", braidTitle: `Vendor risk ${i + 1}`, quote: q, routingReason: { basis: "target", evidence: "#145", label: "Forager" } }));
    const m = await meet(risks, { text: `${lines.join(". ")}. On #145.`, attendees: ["alicia"] });
    expect(m.proposed.items).toHaveLength(config.maxProposalsPerCapture);
    expect(m.proposed.moreFound).toBe(true);
  });
});

describe("M34: the person it is about confirms, changes or declines it (rule 10)", () => {
  it("CONFIRM saves Alicia's promise as her commitment, private to her; the Ask leaves her inbox; a repeat changes nothing", async () => {
    const m = await meet(ALL);
    const r = await confirmAttributed(as("alicia", 30), m.att(ALICIA));
    expect(r).toMatchObject({ message: "Saved as yours.", record: { state: "confirmed", decidedOn: "2026-10-20" } });
    expect(await db.select().from(t.commitments).where(eq(t.commitments.ownerId, "alicia"))).toEqual([
      expect.objectContaining({ id: `cm-${m.att(ALICIA)}`, what: "Send Kyle the buyer list", dueOn: "2026-10-23", state: "open", captureId: null }),
    ]);
    expect(await asks("alicia")).toEqual([]);
    expect(await confirmAttributed(as("alicia", 31), m.att(ALICIA))).toMatchObject({ message: "You confirmed this already." });
    expect(await db.select().from(t.commitments).where(eq(t.commitments.ownerId, "alicia"))).toHaveLength(1);
    // Kemar's undo of his own save never takes Alicia's promise back: it was her confirm, not his save
    await openReview(as("kemar", 32), m.captureId);
    await fixSpeaker(as("kemar", 32), m.att(UNSURE), "jodian");
    for (const i of m.proposed.items) if (i.state === "needs_ok") await decideExtraction(as("kemar", 32), i.id, { type: "accept" });
    await saveCapture(as("kemar", 33), m.captureId);
    await undoSave(as("kemar", 34), { commandId: "undo-m", captureId: m.captureId });
    expect((await db.select().from(t.commitments).where(eq(t.commitments.ownerId, "alicia")))[0].state).toBe("open");
  });

  it("CONFIRM of Jodian's work writes it as her, through its own machine; the audit says Jodian did it", async () => {
    const m = await meet(ALL);
    await confirmAttributed(as("jodian", 30), m.att(JODIAN));
    expect((await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-160")))[0].state).toBe("done");
    const [move] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, "wi-160"), eq(t.auditEntries.machine, "work_item")));
    expect(move).toMatchObject({ actorId: "jodian", captureId: m.captureId });
  });

  it("NeverOverwriteUnseen: #160 moved since the meeting, so Jodian's confirm writes nothing and says what it is now", async () => {
    const m = await meet(ALL);
    await db.update(t.workItems).set({ state: "blocked" }).where(eq(t.workItems.id, "wi-160"));
    await expect(confirmAttributed(as("jodian", 30), m.att(JODIAN))).rejects.toThrow("it is blocked now, not in_progress as the note saw it");
    expect((await item(m.att(JODIAN))).state).toBe("proposed");
  });

  it("rule 10, P10: nobody else answers it, not even the recorder or a PM, and nobody else can read it", async () => {
    const m = await meet(ALL);
    for (const who of ["kemar", "jodian"]) await expect(confirmAttributed(as(who), m.att(ALICIA))).rejects.toMatchObject({ code: "not_found" });
    await expect(declineAttributed(as("alicia"), m.att(JODIAN))).rejects.toMatchObject({ code: "not_found" });
    expect(await describeAttributed(db, m.att(ALICIA), "kemar")).toBeNull();
    // Rule 9: she sees only the words that fed it, never the rest of Kemar's note
    expect(await describeAttributed(db, m.att(ALICIA), "alicia")).toMatchObject({ quote: "Alicia: I'll send Kyle the buyer list Friday", recorder: "Kemar", summary: "Send Kyle the buyer list, by Fri 23 Oct" });
    const inbox = await getInbox(db, "alicia", at(1));
    expect(inbox.items.find((i) => i.cause === "attributed")).toMatchObject({ title: "Kemar's meeting note: Send Kyle the buyer list, by Fri 23 Oct", action: "Confirm", project: { id: "forager" } });
  });

  it("EDIT, then CONFIRM: confirmed in her words, by her day", async () => {
    const m = await meet(ALL);
    await editAttributed(as("alicia", 30), m.att(ALICIA), { value: "Send Kyle the full buyer list", dueOn: "2026-10-26" });
    expect(await item(m.att(ALICIA))).toMatchObject({ state: "proposed", wording: "Send Kyle the full buyer list", dueOn: "2026-10-26" });
    await confirmAttributed(as("alicia", 31), m.att(ALICIA));
    expect((await db.select().from(t.commitments).where(eq(t.commitments.ownerId, "alicia")))[0]).toMatchObject({ what: "Send Kyle the full buyer list", dueOn: "2026-10-26" });
  });

  it("MT5: DECLINE files nothing, and Kemar is told 'Jodian says that's not right'", async () => {
    const m = await meet(ALL);
    await declineAttributed(as("jodian", 30), m.att(JODIAN), "I only started it");
    expect((await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-160")))[0].state).toBe("in_progress");
    expect(await notices("kemar")).toEqual(['Jodian says that\'s not right: #160 Feature store backfill: In progress to Done. "I only started it"']);
    const thread = await getThread(db, "kemar", (await capture(m.captureId)).conversationId!, at(31));
    if (!thread.found) throw new Error("no thread");
    expect(thread.notices.map((x) => x.text)).toContain('Jodian says that\'s not right: #160 Feature store backfill: In progress to Done. "I only started it"');
    expect(thread.turns[0].meeting!.parts.find((p) => p.id === m.att(JODIAN))).toMatchObject({ who: "Jodian", outcome: 'Jodian says that\'s not right: "I only started it"' });
  });

  it("expires unfiled after attributedExpiryDays working days, and Kemar is told; the meeting is done once every part is settled", async () => {
    const m = await meet([ALICIA], { text: "Alicia: I'll send Kyle the buyer list Friday.", attendees: ["alicia"] });
    expect((await capture(m.captureId)).state).toBe("nothing_to_update");
    await timers(2 * DAY); // Thu 22: 2 working days
    expect((await item(m.att(ALICIA))).state).toBe("proposed");
    await timers(3 * DAY); // Fri 23: 3
    expect(await item(m.att(ALICIA))).toMatchObject({ state: "expired" });
    expect(await asks("alicia")).toEqual([]);
    expect(await notices("kemar")).toEqual(["Alicia didn't answer in 3 working days, so this was not filed: Send Kyle the buyer list, by Fri 23 Oct."]);
    expect((await meetingRow(m.meetingId)).state).toBe("done");
  });

  it("withdrawOnLeave (E77): Jodian leaves Forager, and the Ask about her work there is withdrawn; a confirm after is refused", async () => {
    const m = await meet(ALL);
    await leave("forager", "jodian");
    await timers(1);
    expect(await item(m.att(JODIAN))).toMatchObject({ state: "withdrawn", reason: "they left the project" });
    expect(await asks("jodian")).toEqual([]);
  });

  it("rule 4: a confirm after she left files nothing, whatever the Ask showed; it is withdrawn then and there", async () => {
    const m = await meet(ALL);
    await leave("forager", "alicia");
    expect(await confirmAttributed(as("alicia", 1), m.att(ALICIA))).toMatchObject({ message: "You are no longer on this project, so this was withdrawn. Nothing was filed.", record: { state: "withdrawn" } });
    expect(await db.select().from(t.commitments).where(eq(t.commitments.ownerId, "alicia"))).toEqual([]);
    expect(await asks("alicia")).toEqual([]);
  });

  it("withdrawOnLeave (E77): taken off Forager, her open Asks there are withdrawn in that transaction, and the chat stops showing them (P10)", async () => {
    const m = await meet(ALL);
    expect((await getChatSummary(db, "jodian", undefined, at(1))).notices).toHaveLength(1);
    await db.transaction(async (tx) => {
      await tx.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "jodian")));
      expect(await withdrawOnLeave(tx, at(1), "jodian", "forager")).toEqual([m.att(JODIAN)]);
    });
    expect(await item(m.att(JODIAN))).toMatchObject({ state: "withdrawn", reason: "they left the project" });
    expect(await asks("jodian")).toEqual([]);
    expect((await getChatSummary(db, "jodian", undefined, at(2))).notices).toEqual([]);
    // Alicia's is hers, still on Forager: untouched
    expect((await item(m.att(ALICIA))).state).toBe("proposed");
  });

  it("ownerAtConfirm (rules 4 and 10): #160 is Alicia's now, so Jodian's confirm changes nothing of Alicia's and withdraws it", async () => {
    const m = await meet(ALL);
    await db.update(t.workItems).set({ ownerId: "alicia" }).where(eq(t.workItems.id, "wi-160"));
    expect(await confirmAttributed(as("jodian", 30), m.att(JODIAN))).toMatchObject({ message: "This is no longer yours, so it was withdrawn. Nothing was filed.", record: { state: "withdrawn", reason: "it is no longer theirs" } });
    expect((await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-160")))[0].state).toBe("in_progress");
    expect(await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, "wi-160"), eq(t.auditEntries.machine, "work_item")))).toEqual([]);
    expect(await asks("jodian")).toEqual([]);
    // Nothing goes to Alicia on Jodian's word, nor on Kemar's: he sees it withdrawn on his note's card
    expect(await asks("alicia")).toEqual([`attributed:${m.att(ALICIA)}`]);
    const thread = await getThread(db, "kemar", (await capture(m.captureId)).conversationId!, at(31));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].meeting!.parts.find((p) => p.id === m.att(JODIAN))).toMatchObject({ state: "withdrawn", outcome: "Withdrawn: it is no longer theirs." });
  });

  it("ownerAtConfirm: the daily timer withdraws an Ask whose record changed hands that nobody answered", async () => {
    const m = await meet(ALL);
    await db.update(t.workItems).set({ ownerId: "alicia" }).where(eq(t.workItems.id, "wi-160"));
    await timers(1);
    expect(await item(m.att(JODIAN))).toMatchObject({ state: "withdrawn", reason: "it is no longer theirs" });
    expect(await asks("jodian")).toEqual([]);
  });
});

describe("MT12: someone on leave", () => {
  const KEMAR_PROMISE = promiseBy("kemar", "Kemar: I'll send Andre the column list next week", "Send Andre the column list");
  const text = "Kemar: I'll send Andre the column list next week.";

  it("an Ask that arrives while he is away waits until he is back; then it reaches him and its timer starts", async () => {
    // Alicia records on Mon 26 Oct, Kemar's first day away
    const m = await meet([KEMAR_PROMISE], { by: "alicia", text, attendees: ["kemar"], minutes: 6 * DAY });
    expect(await item(m.att(KEMAR_PROMISE))).toMatchObject({ state: "waiting", askedOn: null });
    expect(await asks("kemar")).toEqual([]);
    await timers(7 * DAY);
    expect((await item(m.att(KEMAR_PROMISE))).state).toBe("waiting");
    await timers(13 * DAY); // Mon 2 Nov: back
    expect(await item(m.att(KEMAR_PROMISE))).toMatchObject({ state: "proposed", askedOn: "2026-11-02" });
    expect(await asks("kemar")).toHaveLength(1);
    await timers(15 * DAY);
    expect((await item(m.att(KEMAR_PROMISE))).state).toBe("proposed");
    await timers(16 * DAY); // Thu 5 Nov: 3 working days in
    expect((await item(m.att(KEMAR_PROMISE))).state).toBe("expired");
  });

  it("pauseOnLeave: asked before his leave, the days away never count", async () => {
    // Alicia records on Thu 22 Oct; Fri 23 is one day in, then he is away until Fri 30
    const m = await meet([KEMAR_PROMISE], { by: "alicia", text, attendees: ["kemar"], minutes: 2 * DAY });
    expect((await item(m.att(KEMAR_PROMISE))).askedOn).toBe("2026-10-22");
    for (const day of [6, 7, 8, 13]) {
      await timers(day * DAY);
      expect((await item(m.att(KEMAR_PROMISE))).state).toBe("proposed");
    }
    await timers(14 * DAY); // Tue 3 Nov: Fri 23, Mon 2, Tue 3
    expect((await item(m.att(KEMAR_PROMISE))).state).toBe("expired");
  });
});

describe("MT7: two notes of the same meeting (CD18)", () => {
  const text = "Jodian finished the backfill #160.";
  it("the second, merged, asks nothing already asked; a decline tells both recorders", async () => {
    const first = await meet([JODIAN], { by: "alicia", text, attendees: ["jodian", "kemar"] });
    const { meetingId, captureId } = await createMeetingNote(as("kemar", 30), { text, projectId: "forager", messageId: "m-second" });
    const thread = await getThread(db, "kemar", (await capture(captureId)).conversationId!, at(30));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].meeting!.merge).toEqual({ id: first.meetingId, recorder: "Alicia", time: "9:10am" });
    await confirmAttendees(as("kemar", 30), meetingId, { attendees: ["jodian", "alicia"], told: true, merge: true });
    expect((await meetingRow(meetingId)).mergedWith).toBe(first.meetingId);
    await proposeItems(as("kemar", 30), captureId, [JODIAN]);
    expect(await db.select().from(t.attributedItems).where(eq(t.attributedItems.meetingId, meetingId))).toEqual([]);
    expect(await asks("jodian")).toEqual([`attributed:${first.att(JODIAN)}`]);
    expect((await item(first.att(JODIAN))).alsoFrom).toEqual([{ recorderId: "kemar", captureId, meetingId }]);
    expect(await describeAttributed(db, first.att(JODIAN), "jodian")).toMatchObject({ recorder: "Alicia", alsoFrom: ["Kemar"] });
    await declineAttributed(as("jodian", 40), first.att(JODIAN));
    expect(await notices("alicia")).toEqual(["Jodian says that's not right: #160 Feature store backfill: In progress to Done."]);
    expect(await notices("kemar")).toEqual(["Jodian says that's not right: #160 Feature store backfill: In progress to Done."]);
  });

  it("whichever is read first: the second, merged before the first was read, asks; the first asks nothing again", async () => {
    // Alicia says who was there, but her note is not read yet
    const first = await createMeetingNote(as("alicia"), { text, projectId: "forager", messageId: "m-first" });
    await confirmAttendees(as("alicia"), first.meetingId, { attendees: ["jodian", "kemar"], told: true });
    const second = await meet([JODIAN], { text, attendees: ["jodian", "alicia"], minutes: 30, merge: true });
    expect((await meetingRow(second.meetingId)).mergedWith).toBe(first.meetingId);
    expect(await asks("jodian")).toEqual([`attributed:${second.att(JODIAN)}`]);
    await proposeItems(as("alicia", 40), first.captureId, [JODIAN]);
    expect(await asks("jodian")).toEqual([`attributed:${second.att(JODIAN)}`]);
    expect(await notices("jodian")).toHaveLength(1);
    expect(await db.select().from(t.attributedItems).where(eq(t.attributedItems.meetingId, first.meetingId))).toEqual([]);
    expect((await item(second.att(JODIAN))).alsoFrom).toEqual([{ recorderId: "alicia", captureId: first.captureId, meetingId: first.meetingId }]);
  });

  it("M1, P10: a note of a meeting she was not named at is never offered to Alicia, nor merged with", async () => {
    await meet([JODIAN], { text, attendees: ["jodian"] });
    const hers = await createMeetingNote(as("alicia", 30), { text, projectId: "forager", messageId: "m-hers" });
    const thread = await getThread(db, "alicia", (await capture(hers.captureId)).conversationId!, at(30));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].meeting!.merge).toBeNull();
    await confirmAttendees(as("alicia", 30), hers.meetingId, { attendees: ["jodian", "kemar"], told: true, merge: true });
    expect((await meetingRow(hers.meetingId)).mergedWith).toBeNull();
  });

  it("M1, P10: named at Alicia's meeting, Kemar is offered the merge, but it is taken only if he names her as there too", async () => {
    const first = await meet([JODIAN], { by: "alicia", text, attendees: ["jodian", "kemar"] });
    const mine = await createMeetingNote(as("kemar", 30), { text, projectId: "forager", messageId: "m-mine" });
    const thread = await getThread(db, "kemar", (await capture(mine.captureId)).conversationId!, at(30));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].meeting!.merge).toMatchObject({ id: first.meetingId });
    await confirmAttendees(as("kemar", 30), mine.meetingId, { attendees: ["jodian"], told: true, merge: true });
    expect((await meetingRow(mine.meetingId)).mergedWith).toBeNull();
  });

  it("kept separate, the second note asks again; a note from another project or hours later is no match", async () => {
    await meet([JODIAN], { by: "alicia", text, attendees: ["jodian", "kemar"] });
    await meet([JODIAN], { text, attendees: ["jodian", "alicia"], minutes: 30, merge: false });
    expect(await asks("jodian")).toHaveLength(2);
    const later = await createMeetingNote(as("kemar", 4 * 60), { text, projectId: "forager", messageId: "m-late" });
    const thread = await getThread(db, "kemar", (await capture(later.captureId)).conversationId!, at(4 * 60));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].meeting!.merge).toBeNull();
  });
});
