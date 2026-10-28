// M22 against PGlite (conversational plan, phase E; research model commitment.mjs with fixes anyLive and
// recordAtSave). Kemar promises at 9:10am on Tuesday 20 Oct; his leave is Mon 26 to Fri 30 Oct. Every move runs the
// machine as the person or the rule, checked when it runs. Until phase F a check-in is a notice in his chat plus an
// inbox item, and only he ever sees a promise (CD3).
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureExtractor, KEMAR_PROMISE } from "../atlas/fixture";
import type { Extractor } from "../atlas/extractor";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { config } from "../domain/config";
import { getChatSummary, getThread } from "../queries/chat";
import { getInbox } from "../queries/inbox";
import { getReview } from "../queries/review";
import { commitments as promisesAnswer } from "../queries/answers/commitments";
import { at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";
import { answerCommitment, runCommitmentTimers } from "./commitment";
import { CommandRefused } from "./core";
import { evaluateProject } from "./evaluate";
import { undoSave } from "./undo";
import { moveWorkItem } from "./work";

let db: Db;
const DAY = 24 * 60;
/** Minutes after 9:10am Tuesday 20 Oct to 9:30am on another day: Thursday is 2, Monday 26 Oct is 6. */
const morning = (days: number) => days * DAY + 20;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const timers = (minutes: number) => runCommitmentTimers({ db, now: at(minutes) });
const row = async (id: string) => (await db.select().from(t.commitments).where(eq(t.commitments.id, id)))[0];
const notices = async (who: string, id: string) => (await db.select().from(t.notices).where(and(eq(t.notices.personId, who), eq(t.notices.subjectId, id)))).map((n) => n.text);
const live = async (who: string) =>
  (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open" && i.causeKey.startsWith("commitment")).map((i) => i.causeKey).sort();
const SEEDED = "cm-kemar-columns";

const PROMISE: RawProposal = {
  kind: "commitment",
  projectId: null,
  routingReason: { basis: "personal", evidence: "I'll", label: "You" },
  targetId: "wi-151",
  newValue: "promised",
  promise: "Send Kyle the access request",
  quote: "I'll send Kyle the access request for #151 tomorrow",
  confidence: "high",
  rationale: "Your promise.",
};

let n = 0;
/** Kemar says it in the DPM chat, accepts every item and saves. Returns the commitment the save opened. */
async function kemarSays(proposal: RawProposal, minutes = 0, opts: { edit?: string; conversationId?: string | null } = {}) {
  const text = `${proposal.quote}.`;
  const { captureId, conversationId } = await createCapture(as("kemar", minutes), { channel: "app", messageId: `cm-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), conversationId: opts.conversationId ?? null });
  const { items } = await proposeItems(as("kemar", minutes), captureId, [proposal]);
  await openReview(as("kemar", minutes), captureId);
  const review = await getReview(db, "kemar", captureId);
  if (!review.found) throw new Error("no review");
  for (const i of items) {
    if (opts.edit) await decideExtraction(as("kemar", minutes), i.id, { type: "edit", value: opts.edit });
    else if (i.state === "needs_ok") await decideExtraction(as("kemar", minutes), i.id, { type: "accept" });
  }
  const saved = await saveCapture(as("kemar", minutes), captureId);
  return { captureId, conversationId: conversationId!, id: `cm-${items[0]?.id}`, item: items[0], card: review.items[0], saved };
}

/** A message in the chat read by the recorded Atlas (no model): DPM's own rules answer what they can. */
async function say(text: string, minutes: number, conversationId: string | null, extractor: Extractor = createFixtureExtractor()) {
  const created = await createCapture(as("kemar", minutes), { channel: "app", messageId: `say-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), conversationId });
  const read = await readCapture(as("kemar", minutes), created.captureId, extractor, { retryDelayMs: () => 0 });
  const [capture] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { read, capture };
}

describe("a promise saved from the review (M22 SAVE)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("is Kemar's own commitment: the card shows the day to correct, and nothing on a project changes (CD3)", async () => {
    const before = (await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-151")))[0];
    const { id, card, saved } = await kemarSays(PROMISE);
    expect([card.kindLabel, card.title, card.change, card.markLabel]).toEqual(["Promise", "Send Kyle the access request", 'Due Wed 21 Oct, you said "tomorrow" · #151 Store sales feed access', "Needs your OK"]);
    expect(saved).toMatchObject({ outcome: "saved", projects: [] });
    expect(await row(id)).toMatchObject({ ownerId: "kemar", what: "Send Kyle the access request", dueOn: "2026-10-21", state: "open", linkType: "work_item", linkId: "wi-151", linkProjectId: "forager", moves: 0 });
    expect((await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-151")))[0]).toEqual(before);
    // Nobody else hears of it: no inbox item, no notice, and Alicia's own "What did I promise?" is empty
    expect((await db.select().from(t.inboxItems)).filter((i) => i.causeKey.includes(id))).toEqual([]);
    expect((await promisesAnswer(db, "alicia", { topic: "commitments", asked: "What did I promise?", projectId: null }, at(5))).text).toBe("You have no open promises.");
  });

  it("CM2: Kemar corrects the day on the card, and a day before he said it is refused", async () => {
    const { id } = await kemarSays(PROMISE, 0, { edit: "2026-10-23" });
    expect((await row(id)).dueOn).toBe("2026-10-23");
    const { captureId } = await createCapture(as("kemar", 1), { channel: "app", messageId: "past", kind: "text", text: `${PROMISE.quote}.`, messageAt: at(1), receivedAt: at(1) });
    const { items } = await proposeItems(as("kemar", 1), captureId, [PROMISE]);
    await openReview(as("kemar", 1), captureId);
    await expect(decideExtraction(as("kemar", 1), items[0].id, { type: "edit", value: "2026-10-19" })).rejects.toThrow();
  });

  it("recordAtSave: a promise about work Done since Atlas read it saves as No change, and opens nothing", async () => {
    const { captureId } = await createCapture(as("kemar"), { channel: "app", messageId: "d", kind: "text", text: `${PROMISE.quote}.`, messageAt: at(0), receivedAt: at(0) });
    const { items } = await proposeItems(as("kemar"), captureId, [PROMISE]);
    await openReview(as("kemar"), captureId);
    await decideExtraction(as("kemar"), items[0].id, { type: "accept" });
    await moveWorkItem(as("kemar", 1), "wi-151", "mark_done");
    expect(await saveCapture(as("kemar", 2), captureId)).toMatchObject({ outcome: "saved", noChange: [items[0].id] });
    expect(await row(`cm-${items[0].id}`)).toBeUndefined();
  });

  it("recordAtSave, CM11: a promise about cancelled work saves with its question already asked", async () => {
    const { captureId } = await createCapture(as("kemar"), { channel: "app", messageId: "c", kind: "text", text: `${PROMISE.quote}.`, messageAt: at(0), receivedAt: at(0) });
    const { items } = await proposeItems(as("kemar"), captureId, [PROMISE]);
    await openReview(as("kemar"), captureId);
    await decideExtraction(as("kemar"), items[0].id, { type: "accept" });
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-151"));
    await saveCapture(as("kemar", 2), captureId);
    const id = `cm-${items[0].id}`;
    expect(await row(id)).toMatchObject({ state: "open", stands: "asked" });
    expect(await live("kemar")).toEqual([`commitment_stands:${id}`]);
    expect(await notices("kemar", id)).toEqual(["#151 Store sales feed access was cancelled. Does your promise still stand: Send Kyle the access request?"]);
  });

  it("CM5: the same promise said again moves the live one to its new day, counted, never a second", async () => {
    const first = await kemarSays(PROMISE);
    const again = await kemarSays({ ...PROMISE, quote: "I'll send Kyle the access request for #151 Friday" }, 5);
    expect(again.card.change).toBe("Moves your promise from Wed 21 Oct to Fri 23 Oct · #151 Store sales feed access");
    expect(await row(first.id)).toMatchObject({ dueOn: "2026-10-23", moves: 1, state: "open" });
    expect(await row(again.id)).toBeUndefined();
    // While it is due too (the model's anyLive): back to open
    await timers(morning(4));
    expect((await row(first.id)).state).toBe("due");
    await kemarSays({ ...PROMISE, quote: "I'll send Kyle the access request for #151 on the 3rd" }, morning(4) + 5);
    expect(await row(first.id)).toMatchObject({ state: "open", dueOn: "2026-11-03", moves: 2 });
  });

  it("an undo of the save drops the promise it opened, as its owner (as CD34)", async () => {
    const { id, captureId } = await kemarSays(PROMISE);
    await undoSave(as("kemar", 2), { commandId: "undo-1", captureId });
    expect(await row(id)).toMatchObject({ state: "dropped", endedBy: "owner" });
  });
});

describe("due, check-ins and the owner's answers (M22 timers)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("TIMER due at the end of the due day; the check-in waits for the morning, then is a notice and an inbox item", async () => {
    const { id } = await kemarSays(PROMISE);
    await timers(DAY + 13 * 60); // Wed 21 Oct, 10:10pm: still its day
    expect((await row(id)).state).toBe("open");
    await timers(DAY + 15 * 60); // Thu 22 Oct, 0:10am: the day ended, but no check-in in the night
    expect(await row(id)).toMatchObject({ state: "due", checkIns: 0 });
    expect(await notices("kemar", id)).toEqual([]);
    await timers(morning(2)); // Thursday 9:30am
    expect(await row(id)).toMatchObject({ state: "checking", checkIns: 1, checkInOut: true, checkInOn: "2026-10-22" });
    expect(await notices("kemar", id)).toEqual(["Did you send Kyle the access request (#151 Store sales feed access)? You said you would by Wed 21 Oct."]);
    expect(await live("kemar")).toContain(`commitment_check:${id}`);
    const item = (await getInbox(db, "kemar", at(morning(2)))).items.find((i) => i.causeKey === `commitment_check:${id}`)!;
    expect(item).toMatchObject({ title: "Did you send Kyle the access request?", action: "Answer", project: null, subject: { type: "commitment", id } });
    // Run again the same morning: nothing moves twice (rule 6)
    expect(await timers(morning(2) + 5)).toEqual(expect.not.arrayContaining([expect.objectContaining({ id })]));
  });

  it("Done from the check-in ends it; the inbox item closes as acted and the chat's buttons go", async () => {
    const { id, conversationId } = await kemarSays(PROMISE);
    await timers(morning(2));
    const thread = await getThread(db, "kemar", conversationId, at(morning(2)));
    expect(thread.found && thread.notices.find((x) => x.subject.id === id)?.promise).toEqual({ id, mode: "check", dropFirst: false, today: "2026-10-22" });
    expect(await answerCommitment(as("kemar", morning(2) + 5), id, { act: "done" })).toMatchObject({ message: "Marked done: Send Kyle the access request." });
    expect(await row(id)).toMatchObject({ state: "done", checkInOut: false, endedBy: "owner" });
    expect(await live("kemar")).not.toContain(`commitment_check:${id}`);
    const closed = (await db.select().from(t.inboxItems).where(eq(t.inboxItems.causeKey, `commitment_check:${id}`)))[0];
    expect(closed.state).toBe("acted");
    const after = await getThread(db, "kemar", conversationId, at(morning(2) + 6));
    expect(after.found && after.notices.find((x) => x.subject.id === id)).toMatchObject({ promiseOutcome: "Marked done." });
    expect(after.found && after.notices.find((x) => x.subject.id === id)?.promise).toBeUndefined();
    // A second tap changes nothing (rule 6)
    await expect(answerCommitment(as("kemar", morning(2) + 7), id, { act: "drop" })).rejects.toThrow("That promise is already done.");
  });

  it("rule 10, CD3: only the owner answers; anyone else is told it is not found", async () => {
    const { id } = await kemarSays(PROMISE);
    await timers(morning(2));
    await expect(answerCommitment(as("alicia", morning(2) + 1), id, { act: "done" })).rejects.toThrow(CommandRefused);
    expect((await row(id)).state).toBe("checking");
  });

  it("a second check-in the next working day, then lapsed with a notice to the owner only", async () => {
    const { id } = await kemarSays(PROMISE);
    await timers(morning(2));
    await timers(morning(3)); // Friday: no reply on Thursday
    expect(await row(id)).toMatchObject({ state: "checking", checkIns: config.commitmentCheckIns, checkInOut: true, checkInOn: "2026-10-23" });
    expect((await notices("kemar", id)).at(-1)).toBe("Checking again: Did you send Kyle the access request (#151 Store sales feed access)? You said you would by Wed 21 Oct.");
    await timers(morning(4)); // Saturday: no reply on Friday, the last check-in
    expect(await row(id)).toMatchObject({ state: "lapsed", checkInOut: false, endedBy: "no_reply" });
    expect((await notices("kemar", id)).at(-1)).toBe('No reply about "Send Kyle the access request", so I\'ve stopped checking on it. It stays in your promises as closed.');
    expect(await live("kemar")).not.toContain(`commitment_check:${id}`);
    expect((await db.select().from(t.notices).where(eq(t.notices.subjectId, id))).every((x) => x.personId === "kemar")).toBe(true);
  });

  it("CM7, CM8: due on a weekend or during leave, the check-in waits for the first working day back", async () => {
    const { id } = await kemarSays({ ...PROMISE, quote: "I'll send Kyle the access request for #151 Friday" });
    await timers(morning(4)); // Saturday 24 Oct
    expect(await row(id)).toMatchObject({ state: "due", checkIns: 0 });
    await timers(morning(6)); // Monday 26 Oct: Kemar's leave starts
    expect(await row(id)).toMatchObject({ state: "due", checkIns: 0 });
    await timers(morning(10)); // Friday 30 Oct: still away
    expect((await row(id)).checkIns).toBe(0);
    await timers(morning(13)); // Monday 2 Nov: back
    expect(await row(id)).toMatchObject({ state: "checking", checkIns: 1, checkInOn: "2026-11-02" });
  });

  it("a new date goes back to open, counted; after 3 moves the check-in asks whether to drop it (CD24, CM10)", async () => {
    const { id, conversationId } = await kemarSays(PROMISE);
    // Each check-in comes the first working day Kemar is in after the day it is due (he is away 26 to 30 Oct)
    for (const [day, move, dueOn] of [[2, 1, "2026-10-23"], [13, 2, "2026-11-02"], [14, 3, "2026-11-03"]] as const) {
      await timers(morning(day));
      expect((await row(id)).state).toBe("checking");
      await answerCommitment(as("kemar", morning(day) + 1), id, { act: "date", dueOn });
      expect(await row(id)).toMatchObject({ state: "open", dueOn, moves: move, checkIns: 0, checkInOut: false });
    }
    await timers(morning(15)); // Wed 4 Nov
    expect((await notices("kemar", id)).at(-1)).toBe("Did you send Kyle the access request (#151 Store sales feed access)? You said you would by Tue 3 Nov. It has moved 3 times. If it no longer stands, drop it.");
    const thread = await getThread(db, "kemar", conversationId, at(morning(15)));
    expect(thread.found && thread.notices.find((x) => x.subject.id === id)?.promise?.dropFirst).toBe(true);
    // A day already past is refused, and nothing moves
    await expect(answerCommitment(as("kemar", morning(15) + 1), id, { act: "date", dueOn: "2026-11-02" })).rejects.toThrow("Pick a day from today on.");
    await answerCommitment(as("kemar", morning(15) + 2), id, { act: "drop" });
    expect(await row(id)).toMatchObject({ state: "dropped", endedBy: "owner" });
  });

  it("the seeded promise from Friday is due, and the first run on Tuesday morning checks in on it", async () => {
    await timers(0);
    expect(await row(SEEDED)).toMatchObject({ state: "checking", checkIns: 1 });
    expect(await notices("kemar", SEEDED)).toEqual(["Did you send Andre the buyers' column list? You said you would by Mon 19 Oct."]);
    // It belongs to no conversation, so it shows in his newest one, with its buttons
    expect((await getChatSummary(db, "kemar", undefined, at(1))).notices[0]).toMatchObject({ subject: { type: "commitment", id: SEEDED }, promise: { mode: "check" } });
  });
});

describe("the rules on a commitment's link, and a later update (M22, CM6, CM9, CM11)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("its linked work going Done ends it as done by the rule, withdrawing a check-in that is out, and Kemar is told", async () => {
    const { id } = await kemarSays(PROMISE);
    await timers(morning(2));
    await moveWorkItem(as("kemar", morning(2) + 1), "wi-151", "mark_done");
    expect(await row(id)).toMatchObject({ state: "done", endedBy: "work_done", checkInOut: false });
    expect((await notices("kemar", id)).at(-1)).toBe("#151 Store sales feed access is Done, so I marked your promise done: Send Kyle the access request.");
    expect(await live("kemar")).not.toContain(`commitment_check:${id}`);
  });

  it("CM11: its work cancelled asks once; It still stands keeps it, and it is never asked again", async () => {
    const { id } = await kemarSays(PROMISE);
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-151"));
    await db.transaction((tx) => evaluateProject(tx, "forager", at(5)));
    expect(await row(id)).toMatchObject({ state: "open", stands: "asked" });
    expect(await live("kemar")).toEqual([`commitment_stands:${id}`]);
    const item = (await getInbox(db, "kemar", at(6))).items.find((i) => i.causeKey === `commitment_stands:${id}`)!;
    expect(item).toMatchObject({ title: "Does your promise still stand? Send Kyle the access request", why: "#151 Store sales feed access was cancelled; keep it, or drop it" });
    expect(await answerCommitment(as("kemar", 7), id, { act: "keep" })).toMatchObject({ message: "Kept: Send Kyle the access request. I'll check on it when it's due." });
    await db.transaction((tx) => evaluateProject(tx, "forager", at(8)));
    await timers(9);
    expect(await row(id)).toMatchObject({ state: "open", stands: "kept" });
    expect(await notices("kemar", id)).toHaveLength(1);
  });

  it("CM9: Kemar leaves Forager; the promise stays his, the link goes, and no check-in names the record", async () => {
    const { id } = await kemarSays(PROMISE);
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "kemar")));
    await timers(morning(2));
    expect(await row(id)).toMatchObject({ state: "checking", linkId: null, linkType: null, linkProjectId: null });
    expect(await notices("kemar", id)).toEqual(["Did you send Kyle the access request? You said you would by Wed 21 Oct."]);
  });

  it("CM6: a later update that says it was done is proposed as done in its review, and saving it ends it", async () => {
    const { id } = await kemarSays(PROMISE);
    await timers(morning(2));
    const sent: RawProposal = { ...PROMISE, newValue: "done", commitmentId: id, promise: null, targetId: null, quote: "Sent Kyle the access request this morning" };
    const later = await kemarSays(sent, morning(2) + 30);
    expect([later.card.kindLabel, later.card.title, later.card.change]).toEqual(["Promise", "Send Kyle the access request", "Mark your promise done"]);
    expect(await row(id)).toMatchObject({ state: "done", endedBy: "owner", checkInOut: false });
    expect(await live("kemar")).not.toContain(`commitment_check:${id}`);
  });

  it("CM6 after it was dropped: the save stops with a reason to reject the item, and nothing changes", async () => {
    const { id } = await kemarSays(PROMISE);
    const sent: RawProposal = { ...PROMISE, newValue: "done", commitmentId: id, promise: null, targetId: null, quote: "Sent Kyle the access request" };
    const { captureId } = await createCapture(as("kemar", 5), { channel: "app", messageId: "late", kind: "text", text: `${sent.quote}.`, messageAt: at(5), receivedAt: at(5) });
    const { items } = await proposeItems(as("kemar", 5), captureId, [sent]);
    await openReview(as("kemar", 5), captureId);
    await decideExtraction(as("kemar", 5), items[0].id, { type: "accept" });
    await answerCommitment(as("kemar", 6), id, { act: "drop" });
    expect(await saveCapture(as("kemar", 7), captureId)).toMatchObject({ outcome: "conflict", refused: [{ itemId: items[0].id, reason: "That promise is dropped now, so it can't be marked done. Reject it" }] });
    expect((await row(id)).state).toBe("dropped");
  });
});

describe("in the chat and CM12 (no model)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("the recorded promise goes through the read, the checks and the review like any other item", async () => {
    const { read, capture } = await say(KEMAR_PROMISE, 0, null);
    expect(read).toMatchObject({ outcome: "proposed", state: "proposed" });
    const review = await getReview(db, "kemar", capture.id);
    expect(review.found && review.groups.map((g) => [g.label, g.items.map((i) => i.change)])).toEqual([["You", ['Due Wed 21 Oct, you said "tomorrow" · #151 Store sales feed access']]]);
  });

  it("a typed reply answers the one check-in waiting where it shows, read by DPM's rule", async () => {
    const { id, conversationId } = await kemarSays(PROMISE);
    await timers(morning(2));
    // The seeded promise waits too: with two waiting, a reply answers neither, and nothing moves
    expect((await say("Done", morning(2) + 1, conversationId)).capture.state).toBe("failed");
    expect((await row(id)).state).toBe("checking");
    await answerCommitment(as("kemar", morning(2) + 2), SEEDED, { act: "drop" });
    const moved = await say("Move it to Monday", morning(2) + 5, conversationId);
    expect(moved.capture).toMatchObject({ state: "answered", commandNote: "Moved to Mon 26 Oct: Send Kyle the access request." });
    expect(await row(id)).toMatchObject({ state: "open", dueOn: "2026-10-26", moves: 1 });
    // Nothing waits now, so "Done" is not an answer to it (and with no recording, no read happens)
    const done = await say("Done", morning(2) + 6, conversationId);
    expect(done.capture.state).toBe("failed");
    expect((await row(id)).state).toBe("open");
  });

  it("a typed reply elsewhere is not an answer to it, and a day already past is said back", async () => {
    const { id, conversationId } = await kemarSays(PROMISE);
    await timers(morning(2));
    await answerCommitment(as("kemar", morning(2)), SEEDED, { act: "done" });
    expect((await say("Done", morning(2) + 1, null)).capture.state).not.toBe("answered");
    const past = await say("Move it to Monday the 19th", morning(2) + 2, conversationId);
    expect(past.capture).toMatchObject({ state: "answered", commandNote: "Pick a day from today on." });
    expect((await row(id)).state).toBe("checking");
    expect((await say("done", morning(2) + 3, conversationId)).capture.commandNote).toBe("Marked done: Send Kyle the access request.");
  });

  it("CM12: \"What did I promise?\" lists only the asker's own open and due promises, soonest first", async () => {
    await kemarSays(PROMISE);
    await timers(1); // the seeded one from Friday is checked in on
    const { capture } = await say("What did I promise?", 2, null);
    expect(capture.answer).toMatchObject({ topic: "commitments", text: "You have 2 open promises, 1 due." });
    expect(capture.answer!.cards.map((c) => [c.title, c.detail, c.tag])).toEqual([
      ["Send Andre the buyers' column list", "Due Mon 19 Oct", "Due · checking in"],
      ["Send Kyle the access request", "Due Wed 21 Oct · #151 Store sales feed access", "Open"],
    ]);
    // On a named project, only the promises about its records
    expect((await promisesAnswer(db, "kemar", { topic: "commitments", asked: "What did I promise on Store Insights?", projectId: "insights" }, at(3))).text).toBe("You have no open promises about Store Insights.");
    // Andre shares Store Insights with Kemar and still sees nothing of his (CD3)
    expect((await promisesAnswer(db, "andre", { topic: "commitments", asked: "What did I promise?", projectId: null }, at(3))).cards).toEqual([]);
  });
});
