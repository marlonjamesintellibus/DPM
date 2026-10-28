// Phase G against PGlite (conversational plan, section 9): drafts asked for in the chat (M25). "Draft my
// standup", "Draft a client status for Forager" and "Draft the weekly summary for Forager" are read as the
// asker's own commands, the right checked when they run (DR3), the facts read for the asker (P10); Atlas writes
// the draft, checked against its facts (DR2), with the plain template after the tries or with no model (DR6).
// Every edge case DR1 to DR8, the model check's three fixes (the model timer, the client view checked at copy,
// Refresh drawn), and rule 6 on the buttons.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Drafter } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import type { Db } from "../db/client";
import { loadItems } from "../db/records";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { draftProblem, draftTemplate } from "../domain/drafts";
import { getThread } from "../queries/chat";
import { knownNames } from "../queries/drafts";
import { at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { resolveBraidEntry } from "./braid";
import { createCapture, decideExtraction, openReview, saveCapture } from "./capture";
import { CommandRefused } from "./core";
import { CLIENT_VIEW_CHANGED, copyDraft, discardDraft, editDraft, refreshDraft, requestDraft, runDraftTimers, writeDraft } from "./draft";
import { evaluateProject } from "./evaluate";
import { saveReason, setStatus, shareReasonWithClient, useCalculated } from "./status";

let db: Db;
let n = 0;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const draftRow = async (captureId: string) => (await db.select().from(t.drafts).where(eq(t.drafts.captureId, captureId)))[0];
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommandRefused) return e.reason;
    throw e;
  }
  return null;
};

/** Atlas that writes these drafts in turn, and keeps what it was shown. */
function writes(...texts: (string | Error)[]) {
  const shown: { system: string; user: string }[] = [];
  const drafter: Drafter = {
    name: "test",
    async draft(system, user) {
      shown.push({ system, user });
      const next = texts[Math.min(shown.length, texts.length) - 1];
      if (next instanceof Error) throw next;
      return { text: next, model: "test-model", usage: null };
    },
  };
  return { drafter, shown };
}

/** A message in the DPM chat, read by the recorded Atlas; the draft it asks for is written by `drafter` (none: no model, DR6). */
async function say(who: string, text: string, minutes = 0, drafter: Drafter | null = null, opts: { atlasChatId?: string } = {}) {
  const ctx = as(who, minutes);
  const created = await createCapture(ctx, { channel: opts.atlasChatId ? "atlas" : "app", messageId: `g-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), atlasChatId: opts.atlasChatId });
  await readCapture(ctx, created.captureId, createFixtureExtractor(), { retryDelayMs: () => 0, drafter });
  const [capture] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { captureId: created.captureId, conversationId: created.conversationId!, answer: capture.answer, question: capture.question };
}

async function kemarSavesHisNote(minutes = 1) {
  const { items } = await loadItems(db, "cap-kemar-0858");
  await openReview(as("kemar", minutes), "cap-kemar-0858");
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as("kemar", minutes), i.id, { type: "accept" });
  expect((await saveCapture(as("kemar", minutes), "cap-kemar-0858")).outcome).toBe("saved");
}

describe("my standup", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("DR1, DR6: nothing saved since yesterday and no model: the plain template says so, with what is in progress", async () => {
    const asked = await say("kemar", "Draft my standup");
    expect(asked.question).toMatchObject({ topic: "draft", draft: "standup" });
    const row = await draftRow(asked.captureId);
    expect([row.state, row.by, row.kind, row.projectId]).toEqual(["ready", "plain", "standup", null]);
    expect(row.text).toBe(draftTemplate(row.facts));
    expect(row.text).toContain("Since yesterday: No changes since yesterday.");
    expect(row.text).toContain("In progress:\n- #145 Google Trends connector (Forager 2.0), due Wed 21 Oct");
    expect(asked.answer?.text).toBe("Here's a draft of your standup, from what you saved since yesterday and your open work. Edit it, then copy it.");
    // Phase E: his promise from Friday, due Monday and still open, is in the Due part
    expect(row.text).toContain("Due:\n- Send Andre the buyers' column list, due Mon 19 Oct");
  });

  it("phase E: his own promises due by today, with the record each names while he reads its project; none of anyone else's, none due later", async () => {
    const promise = (id: string, ownerId: string, what: string, dueOn: string, link: { type: "work_item"; id: string; projectId: string } | null = null) => ({
      id,
      ownerId,
      what,
      dueOn,
      state: "open" as const,
      savedOn: "2026-10-16",
      linkType: link?.type ?? null,
      linkId: link?.id ?? null,
      linkProjectId: link?.projectId ?? null,
    });
    await db.insert(t.commitments).values([
      promise("cm-today", "kemar", "Send the export to Andre", "2026-10-20", { type: "work_item", id: "wi-208", projectId: "insights" }),
      promise("cm-later", "kemar", "Share the scoring notes", "2026-10-23"),
      promise("cm-alicia", "alicia", "Call Kyle about the feed", "2026-10-19"),
    ]);
    const row = await draftRow((await say("kemar", "Draft my standup")).captureId);
    expect(row.text).toContain("Due:\n- Send Andre the buyers' column list, due Mon 19 Oct\n- Send the export to Andre (#208 Weekly sales export), due today");
    expect(row.text).not.toContain("scoring notes");
    expect(row.text).not.toContain("Call Kyle");
    expect(row.facts.projectIds).toContain("insights");
    // A standup about Forager keeps only the promises about its records (as "What did I promise?" does)
    const forager = await draftRow((await say("kemar", "Draft my standup for Forager", 1)).captureId);
    expect(forager.text ?? "").not.toContain("Due:");
    // P10, CM9: off Store Insights, the promise stays his, without the record it named
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const after = await draftRow((await say("kemar", "Draft my standup", 2)).captureId);
    expect(after.text).toContain("- Send the export to Andre, due today");
    expect(after.text).not.toContain("#208");
    expect(after.facts.projectIds).toEqual(["forager"]);
  });

  it("DR2: Atlas's draft that keeps to the facts is used as written", async () => {
    const good = "Nothing new since yesterday. I'm on #145 Google Trends connector, due Wed 21 Oct.";
    const { drafter, shown } = writes(good);
    const asked = await say("kemar", "Draft my standup", 0, drafter);
    const row = await draftRow(asked.captureId);
    expect([row.state, row.by, row.text]).toEqual(["ready", "atlas", good]);
    expect(shown).toHaveLength(1);
    expect(shown[0].user).toBe(`<facts>\n${draftTemplate(row.facts)}\n</facts>`);
  });

  it("DR2: a draft that adds a record or a date is refused and tried again; after the tries it is the plain template", async () => {
    const { drafter, shown } = writes("I finished #152 and it's due Monday.", "Kyle sent the feed, so #145 is done.");
    const asked = await say("kemar", "Draft my standup", 0, drafter);
    const row = await draftRow(asked.captureId);
    expect([row.state, row.by, row.text]).toEqual(["ready", "plain", draftTemplate(row.facts)]);
    expect(shown).toHaveLength(2);
    const audits = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.machine, "draft"), eq(t.auditEntries.subjectId, row.id)));
    expect(audits.map((a) => [a.action, a.toState])).toEqual([
      ["REQUEST", "requested"],
      ["DRAFTED", "requested"],
      ["DRAFTED", "ready"],
    ]);
    // A model error on the first try, then a good draft: Atlas's
    const second = writes(new Error("upstream 502"), "Nothing new since yesterday.");
    const again = await draftRow((await say("kemar", "Write up my standup", 1, second.drafter)).captureId);
    expect([again.by, again.text]).toEqual(["atlas", "Nothing new since yesterday."]);
  });

  it("DR2: a status or a time the facts do not give is refused like a made-up date; a name at the start of a sentence too", async () => {
    // #145 is in progress, due Wed 21 Oct: done, tomorrow and Marcus are Atlas's own
    const { drafter, shown } = writes("#145 Google Trends connector is done.", "I'll finish #145 Google Trends connector tomorrow.");
    expect(await draftRow((await say("kemar", "Draft my standup", 0, drafter)).captureId)).toMatchObject({ by: "plain" });
    expect(shown).toHaveLength(2);
    const named = writes("Marcus sent the feed. I'm on #145 Google Trends connector.", "Marcus sent the feed.");
    expect(await draftRow((await say("kemar", "Draft my standup", 1, named.drafter)).captureId)).toMatchObject({ by: "plain" });
  });

  it("CD30: everyday words that are also a record's name pass in lower case; only people Kemar shares a project with are known", async () => {
    // The seed's milestone "Data sources", which his standup was not given
    const fine = "Nothing new since yesterday. I'm on #145 Google Trends connector, due Wed 21 Oct, now that the data sources are in.";
    expect(await draftRow((await say("kemar", "Draft my standup", 0, writes(fine).drafter)).captureId)).toMatchObject({ by: "atlas", text: fine });
    const named = "Nothing new since yesterday. I'm on #145 Google Trends connector, now that Data sources is in.";
    expect(await draftRow((await say("kemar", "Draft my standup", 1, writes(named).drafter)).captureId)).toMatchObject({ by: "plain" });
    // Someone on none of his projects is not a name DPM knows for him (P10)
    await db.insert(t.people).values({ id: "will", name: "Will Grant", initials: "WG", orgRole: "employee" });
    const known = await knownNames(db, "kemar", at(2));
    expect(known.people).toEqual(expect.arrayContaining(["Kemar Brown", "Alicia Campbell", "Kyle"]));
    expect(known.people).not.toContain("Will Grant");
    expect(known.records).toEqual(expect.arrayContaining(["Data sources", "#151", "Weekly sales export"]));
  });

  it("P10: a standup of several projects closes once he leaves one of them, as a draft about one project does", async () => {
    const asked = await say("kemar", "Draft my standup");
    const row = await draftRow(asked.captureId);
    expect(row.facts.projectIds).toEqual(["forager", "insights"]);
    expect(row.text).toContain("#208 Weekly sales export (Store Insights)");
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const thread = await getThread(db, "kemar", asked.conversationId, at(1));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].draft).toMatchObject({ closed: true, text: null, aside: null });
    const gone = "you can no longer read a project this draft is from";
    expect(await refusal(copyDraft(as("kemar", 1), row.id))).toBe(gone);
    expect(await refusal(refreshDraft(as("kemar", 1), row.id))).toBe(gone);
    expect(await refusal(editDraft(as("kemar", 1), row.id, "Today: #145."))).toBe(gone);
    // A standup asked for now holds only what he still reads, and stays open
    const now_ = await draftRow((await say("kemar", "Draft my standup", 2)).captureId);
    expect([now_.facts.projectIds, now_.text?.includes("#208")]).toEqual([["forager"], false]);
  });

  it("since their last standup: a standup draft copied today moves the start to its time", async () => {
    const first = await say("kemar", "Draft my standup");
    await copyDraft(as("kemar", 1), (await draftRow(first.captureId)).id);
    const second = await draftRow((await say("kemar", "Draft my standup", 5)).captureId);
    expect(second.facts.sections[0].title).toBe("Since 9:11am");
    expect(second.text).toContain("No changes since 9:11am.");
  });

  it("rules 3 and 8: a draft is written only in the asker's own chat", async () => {
    const asked = await say("kemar", "Draft my standup", 0, null, { atlasChatId: "group-forager" });
    expect(await draftRow(asked.captureId)).toBeUndefined();
    expect(asked.answer?.text).toBe("I write drafts only in your own chat with me.");
    // The Atlas app's direct chat is theirs
    expect(await draftRow((await say("kemar", "Draft my standup", 1, null, { atlasChatId: "dm" })).captureId)).toBeDefined();
  });

  it("DR8, rule 6: a request delivered twice drafts once; a second copy finds it copied", async () => {
    const asked = await say("kemar", "Draft my standup");
    const [capture] = await db.select().from(t.captures).where(eq(t.captures.id, asked.captureId));
    expect(await db.transaction((tx) => requestDraft(tx, at(1), capture, "standup", null))).toBe(`draft-${asked.captureId}`);
    expect(await db.select().from(t.drafts)).toHaveLength(1);
    const id = (await draftRow(asked.captureId)).id;
    const copied = await copyDraft(as("kemar", 1), id);
    expect(copied.text).toBe((await draftRow(asked.captureId)).text);
    expect(await refusal(copyDraft(as("kemar", 2), id))).toBe("Copied. Paste it where you need it.");
    expect((await draftRow(asked.captureId)).state).toBe("copied");
  });

  it("EDIT keeps their words; Copy copies what is on screen; someone else's draft is not found", async () => {
    const id = (await draftRow((await say("kemar", "Draft my standup")).captureId)).id;
    await editDraft(as("kemar", 1), id, "Yesterday: nothing new. Today: #145.");
    expect((await copyDraft(as("kemar", 2), id, "Today: #145 and #147.")).text).toBe("Today: #145 and #147.");
    const other = (await draftRow((await say("kemar", "Draft my standup", 3)).captureId)).id;
    expect(await refusal(copyDraft(as("alicia", 4), other))).toBe("no such draft");
    expect(await refusal(discardDraft(as("alicia", 4), other))).toBe("no such draft");
  });

  it("Discard ends it with nothing sent", async () => {
    const asked = await say("kemar", "Draft my standup");
    await discardDraft(as("kemar", 1), (await draftRow(asked.captureId)).id);
    const thread = await getThread(db, "kemar", asked.conversationId, at(2));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].draft).toMatchObject({ state: "discarded", ended: "Discarded. Nothing was sent." });
  });

  it("the chat shows the draft under the message: drafting while Atlas writes, then the words as of when its facts were read", async () => {
    const created = await createCapture(as("kemar"), { channel: "app", messageId: "g-chat", kind: "text", text: "Draft my standup", messageAt: at(0), receivedAt: at(0) });
    // Atlas never answers: the draft waits, drafting, for its timer
    const hangs: Drafter = { name: "hangs", draft: () => new Promise(() => undefined) };
    const read = readCapture(as("kemar"), created.captureId, createFixtureExtractor(), { retryDelayMs: () => 0, drafter: hangs });
    let row = await draftRow(created.captureId);
    for (let i = 0; !row && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      row = await draftRow(created.captureId);
    }
    const thread = await getThread(db, "kemar", created.conversationId!, at(0));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].draft).toMatchObject({ state: "requested", label: "standup", text: null });
    // The model check's fix: the timer fails each try, so the draft reaches ready with the plain template
    await runDraftTimers({ db, now: new Date(at(0).getTime() + config.draftModelSeconds * 1000) });
    await runDraftTimers({ db, now: new Date(at(1).getTime() + config.draftModelSeconds * 1000) });
    row = await draftRow(created.captureId);
    expect([row.state, row.by, row.attempt]).toEqual(["ready", "plain", 2]);
    const after = await getThread(db, "kemar", created.conversationId!, at(2));
    if (!after.found) throw new Error("no thread");
    expect(after.turns[0].draft).toMatchObject({ state: "ready", by: "plain", asOf: "9:10am", text: row.text, closed: false, ended: null });
    void read;
  });
});

describe("the model timer and late replies (rule 5, rule 6)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("a try the model leaves unanswered fails on its timer and the next try is written; a late reply to the first changes nothing", async () => {
    const created = await createCapture(as("kemar"), { channel: "app", messageId: "g-late", kind: "text", text: "Draft my standup", messageAt: at(0), receivedAt: at(0) });
    // A slow model: it answers a try only when the test says so, after the timer has ended that try
    let answerFirst: (v: { text: string; model: string; usage: null }) => void = () => undefined;
    const slow: Drafter = { name: "slow", draft: () => new Promise((resolve) => (answerFirst = resolve)) };
    const reading = readCapture(as("kemar"), created.captureId, createFixtureExtractor(), { retryDelayMs: () => 0, drafter: slow });
    let row = await draftRow(created.captureId);
    for (let i = 0; !row && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      row = await draftRow(created.captureId);
    }
    const id = row.id;
    await new Promise((r) => setTimeout(r, 20));
    const early = await runDraftTimers({ db, now: new Date(at(0).getTime() + (config.draftModelSeconds - 1) * 1000) });
    expect(early.failed).toEqual([]);
    const timed = await runDraftTimers({ db, now: new Date(at(0).getTime() + config.draftModelSeconds * 1000) });
    expect([timed.failed, timed.retry]).toEqual([[id], [id]]);
    expect((await draftRow(created.captureId)).attempt).toBe(2);
    // The first try's answer comes late: refused as a reply to an earlier try, and the loop moves on to try 2
    answerFirst({ text: "Nothing new since yesterday.", model: "slow", usage: null });
    await new Promise((r) => setTimeout(r, 20));
    expect((await draftRow(created.captureId)).text).toBeNull();
    await runDraftTimers({ db, now: at(3) });
    expect((await draftRow(created.captureId)).by).toBe("plain");
    void reading;
  }, 20_000);

  it("a ready draft nobody uses expires after draftExpiryHours, and can no longer be copied", async () => {
    const asked = await say("kemar", "Draft my standup");
    const id = (await draftRow(asked.captureId)).id;
    expect((await runDraftTimers({ db, now: new Date(at(0).getTime() + config.draftExpiryHours * 3_600_000 - 1000) })).expired).toEqual([]);
    expect((await runDraftTimers({ db, now: new Date(at(0).getTime() + config.draftExpiryHours * 3_600_000) })).expired).toEqual([id]);
    expect(await refusal(copyDraft(as("kemar", 24 * 60 + 1), id))).toBe("This draft expired. Ask me again for a fresh standup.");
  });
});

describe("client status", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: true });
  }, 30_000);

  it("DR3: a member asking for a client status gets no draft; a PM gets one, checked when it runs", async () => {
    const kemar = await say("kemar", "Draft a client status for Forager");
    expect(await draftRow(kemar.captureId)).toBeUndefined();
    expect(kemar.answer?.text).toBe("Only a PM or Lead of Forager 2.0 can draft a client status.");
    const alicia = await say("alicia", "Draft a client status for Forager", 1);
    expect((await draftRow(alicia.captureId)).state).toBe("ready");
    // No project named: which one, with an example from the projects she leads
    const which = await say("alicia", "Draft a client status", 2);
    expect(which.answer?.text).toBe('Which project is it for? Say it again with its name, for example "Draft a client status for Forager 2.0".');
    expect((await say("kemar", "Draft a client status", 3)).answer?.text).toBe("Only a PM or Lead of a project can draft a client status.");
  });

  it("DR4: only what the client view shows: the releases by their target date, and the status only once the PM shares its reason", async () => {
    const first = await draftRow((await say("alicia", "Draft a client status for Forager")).captureId);
    expect(first.text).toBe("Forager 2.0 for Sprouts: client status, Tue 20 Oct\n\nReleases:\n- Buyer pilot · Release 1: planned Fri 30 Oct\n- Rollout · Release 2: planned Fri 6 Nov");
    for (const internal of ["Trend model", "Data sources", "Production checks", "#151", "Off track"]) expect(first.text).not.toContain(internal);
    await saveReason(as("alicia", 1), "forager", { text: "Waiting on the store feed from Sprouts IT.", entryIds: ["br-feed-blocker"], draftedByAtlas: false, edited: false });
    const unshared = await say("alicia", "Draft a client status for Forager", 2);
    expect((await draftRow(unshared.captureId)).text).not.toContain("Status");
    expect(unshared.answer?.text).toContain("The status goes in only once its reason is shared with the client");
    const [reason] = await db.select().from(t.statusReasons).where(eq(t.statusReasons.projectId, "forager"));
    expect(await refusal(shareReasonWithClient(as("kemar", 3), "forager", reason.id, true))).toBe("only the project's PM shares its status with the client");
    await shareReasonWithClient(as("alicia", 3), "forager", reason.id, true);
    const shared = await say("alicia", "Draft a client status for Forager", 4);
    expect((await draftRow(shared.captureId)).text).toContain("Status:\n- Off track: Waiting on the store feed from Sprouts IT");
    expect(shared.answer?.text).toBe("Here's a draft client status for Forager 2.0. It holds only what the client view shows: the releases and the status you shared. Edit it, then copy it.");
  });

  it("DR4, DR2: a draft that names a milestone the client view does not show is refused, even though Alicia may read it", async () => {
    const { drafter } = writes("Buyer pilot · Release 1 is planned for Fri 30 Oct. The Trend model comes before it.", "Buyer pilot · Release 1 is planned for Fri 30 Oct.");
    const row = await draftRow((await say("alicia", "Draft a client status for Forager", 0, drafter)).captureId);
    expect([row.by, row.text]).toEqual(["atlas", "Buyer pilot · Release 1 is planned for Fri 30 Oct."]);
  });

  it("the model check's ReaderCheck: copy checks the client view now and offers Refresh; Refresh keeps her edits aside (DR5)", async () => {
    const asked = await say("alicia", "Draft a client status for Forager");
    const id = (await draftRow(asked.captureId)).id;
    await editDraft(as("alicia", 1), id, "Hi Kyle, Buyer pilot · Release 1 is planned for Fri 30 Oct.");
    // Release 1 is taken out of the client view after the draft was made
    await db.update(t.milestones).set({ clientVisible: false }).where(eq(t.milestones.id, "ms-release-1"));
    expect(await refusal(copyDraft(as("alicia", 2), id))).toBe(CLIENT_VIEW_CHANGED);
    expect((await draftRow(asked.captureId)).state).toBe("ready");
    // She types an internal milestone in herself: refused too (DR4, "even if asked by name")
    await db.update(t.milestones).set({ clientVisible: true }).where(eq(t.milestones.id, "ms-release-1"));
    expect(await refusal(copyDraft(as("alicia", 3), id, "Release 1 waits on the Trend model."))).toBe(CLIENT_VIEW_CHANGED);
    await db.update(t.milestones).set({ clientVisible: false }).where(eq(t.milestones.id, "ms-release-1"));
    const refreshed = await refreshDraft(as("alicia", 4), id, "Hi Kyle, Buyer pilot · Release 1 is planned for Fri 30 Oct.");
    expect([refreshed.state, refreshed.attempt, refreshed.aside]).toEqual(["requested", 3, "Hi Kyle, Buyer pilot · Release 1 is planned for Fri 30 Oct."]);
    await writeDraft(db, () => at(4), id, null);
    const row = await draftRow(asked.captureId);
    expect(row.text).toBe("Forager 2.0 for Sprouts: client status, Tue 20 Oct\n\nReleases:\n- Rollout · Release 2: planned Fri 6 Nov");
    expect((await copyDraft(as("alicia", 5), id)).text).toBe(row.text);
  });

  it("rule 4, DR3: a PM made a member since cannot copy her client status; the right is read when Copy runs", async () => {
    const asked = await say("alicia", "Draft a client status for Forager");
    const id = (await draftRow(asked.captureId)).id;
    await db.update(t.projectMemberships).set({ role: "member" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    expect(await refusal(copyDraft(as("alicia", 1), id))).toBe("only a PM or Lead of the project can draft a client status");
    expect((await draftRow(asked.captureId)).state).toBe("ready");
    // A Lead again, she can copy it
    await db.update(t.projectMemberships).set({ role: "lead" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    expect((await copyDraft(as("alicia", 2), id)).text).toBe((await draftRow(asked.captureId)).text);
  });

  it("rule 4: a PM who is no longer PM or Lead cannot refresh; P10: one who left the project cannot see or copy its draft", async () => {
    const asked = await say("alicia", "Draft a client status for Forager");
    const id = (await draftRow(asked.captureId)).id;
    await db.update(t.projectMemberships).set({ role: "member" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    expect(await refusal(refreshDraft(as("alicia", 1), id))).toBe("only a PM or Lead of the project can draft a client status");
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    expect(await refusal(copyDraft(as("alicia", 2), id))).toBe("you can no longer read this project");
    const thread = await getThread(db, "alicia", asked.conversationId, at(3));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].draft).toMatchObject({ closed: true, text: null, project: null, aside: null });
  });
});

describe("my standup after a save", () => {
  beforeEach(async () => {
    db = await seededDb();
  }, 30_000);

  it("what they saved since yesterday, told as review tells it, never their words (DR7, CD8)", async () => {
    await kemarSavesHisNote();
    const { drafter, shown } = writes(new Error("down"));
    const asked = await say("kemar", "Draft my standup", 2, drafter);
    const row = await draftRow(asked.captureId);
    const saved = row.facts.sections[0];
    expect(saved.title).toBe("Since yesterday");
    expect(saved.facts.map((f) => f.text)).toEqual(
      expect.arrayContaining([
        "#145 Google Trends connector: In progress to Done (Forager 2.0)",
        "#151 Store sales feed access: In progress to Blocked (Forager 2.0)",
        "Trend model: forecast Mon 26 Oct (Forager 2.0)",
        "Runbook: Not done to Handed to Jodian (Forager 2.0)",
        "Reported a risk: Trend model may slip to 26 Oct (Forager 2.0)",
        "#208 Weekly sales export: In progress to Done (Store Insights)",
      ]),
    );
    // Nothing of Kemar's own words reaches the facts or Atlas, not even "Still waiting on Kyle"
    for (const said of ["waiting on Kyle", "Finished the TikTok", "I think"]) {
      expect(draftTemplate(row.facts)).not.toContain(said);
      expect(shown.map((s) => s.user).join("\n")).not.toContain(said);
    }
  });
});

describe("weekly summary", () => {
  beforeEach(async () => {
    db = await seededDb();
  }, 30_000);

  it("the project's week, from Monday: work done, milestones moved, entries on the log; only for the PM or a Lead", async () => {
    await kemarSavesHisNote();
    expect(await draftRow((await say("kemar", "Draft the weekly summary for Forager", 2)).captureId)).toBeUndefined();
    const asked = await say("alicia", "Draft the weekly summary for Forager", 3);
    const row = await draftRow(asked.captureId);
    expect(row.facts.heading).toBe("Forager 2.0: weekly summary, week of Mon 19 Oct, as of Tue 20 Oct");
    const section = (title: string) => row.facts.sections.find((s) => s.title === title)!.facts.map((f) => f.text);
    expect(section("Work done")).toContain("#145 Google Trends connector");
    expect(section("Milestones")).toEqual(["Trend model: forecast Mon 26 Oct, was Fri 23 Oct"]);
    expect(asked.answer?.text).toBe("Here's a draft weekly summary for Forager 2.0, for this week so far. Edit it, then copy it.");
    // Store Insights is Kemar's and Andre's: nothing of it is in Alicia's summary (P10)
    expect(row.text).not.toMatch(/Insights|#208|weekly sales export/i);
  });

  it("entries that ended this week, and every status move: set by a person, cleared, and ended by the plan (M9)", async () => {
    // The seed: Alicia set Forager Off track at 9:02am. Then she closes the pipeline risk and sets At risk
    await resolveBraidEntry(as("alicia", 10), "br-pipeline-risk", "closed");
    await setStatus(as("alicia", 11), "forager", "at_risk");
    // The plan comes to agree with At risk, so the set status ends on its own (E41)
    await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
    await db.transaction((tx) => evaluateProject(tx, "forager", at(12)));
    const asked = await say("alicia", "Draft the weekly summary for Forager", 13);
    const row = await draftRow(asked.captureId);
    const section = (title: string) => row.facts.sections.find((s) => s.title === title)!.facts.map((f) => f.text);
    expect(section("Ended")).toEqual(["Risk, closed: Only Kemar can run the pipeline"]);
    expect(section("Status")).toEqual(["Alicia set it Off track, Tue 20 Oct", "Alicia set it At risk, Tue 20 Oct", "The set status ended: the plan agrees with it now, Tue 20 Oct"]);
    // Cleared by hand, said as cleared
    await setStatus(as("alicia", 14), "forager", "off_track");
    await useCalculated(as("alicia", 15), "forager");
    const later = await draftRow((await say("alicia", "Draft the weekly summary for Forager", 16)).captureId);
    expect(later.facts.sections.find((s) => s.title === "Status")!.facts.at(-1)?.text).toBe("Alicia cleared the set status, Tue 20 Oct");
    // The plain template passes its own facts check, the status words and "this week" included
    expect(draftProblem(later.facts, draftTemplate(later.facts))).toBeNull();
  });
});
