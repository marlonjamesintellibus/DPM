// Phase K, M29 Signal against PGlite (conversational plan, section 13; research model signal.mjs with the
// model check's fixes). The six rules found in the seeded world, nightly and on save; ACCEPT into a risk
// through M15 and DISMISS, each checked when it runs; the escalation, expiry and snooze timers; the memory per
// episode; and SG1 to SG10.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { getProject } from "../queries/project";
import { getInbox } from "../queries/inbox";
import { signalsFor } from "../queries/signals";
import { seededDb } from "../test/seeded-db";
import type { RawProposal } from "../domain/atlas-checks/types";
import { decideBraidEntry, reportBraidEntry, resolveBraidEntry, runBraidReminders } from "./braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";
import { CommandRefused, StaleVersion } from "./core";
import { acceptSignal, detectSignals, dismissSignal, runSignalTimers, setProjectPaused, stillGoing } from "./signals";

let db: Db;
/** 9am in Jamaica on that day. */
const on = (day: string, hour = 9) => new Date(`${day}T${String(hour + 5).padStart(2, "0")}:00:00Z`);
const as = (actorId: string, day: string, hour = 9) => ({ db, now: on(day, hour), actorId });
const nightly = (day: string) => runSignalTimers({ db, now: on(day, 0) });
const all = () => db.select().from(t.signals);
const signal = async (rule: string, subjectId: string) => (await all()).filter((s) => s.rule === rule && s.subjectId === subjectId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
const latest = async (rule: string, subjectId: string) => (await signal(rule, subjectId)).at(-1)!;
const items = async (who: string) => (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.causeKey.startsWith("signals:"));
const open = async (who: string) => (await items(who)).filter((i) => i.state === "open").map((i) => i.causeKey).sort();
const memory = async (rule: string, subjectId: string) => (await db.select().from(t.signalMemory).where(and(eq(t.signalMemory.rule, rule as never), eq(t.signalMemory.subjectId, subjectId))))[0];
const role = (projectId: string, personId: string, r: "pm" | "lead" | "member") =>
  db.insert(t.projectMemberships).values({ projectId, personId, role: r, state: "member" }).onConflictDoUpdate({ target: [t.projectMemberships.projectId, t.projectMemberships.personId], set: { role: r, state: "member" } });
/** One rule's signals in the viewer's item for Forager that day, as the inbox shows them. */
const view = async (who: string, day: string, rule: string) => (await signalsFor(db, who, "forager", day, on(day, 10))).filter((v) => v.rule === rule);
/** More people report the feed blocker, as saved updates would add their sources (M15 ADD_SOURCE). */
const reports = (entryId: string, people: [string, string][]) => db.insert(t.braidSources).values(people.map(([personId, at]) => ({ id: `src-${entryId}-${personId}-${at}`, entryId, originEntryId: entryId, personId, at: new Date(at) })));

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("the rules over the seeded world", () => {
  it("the nightly run raises each condition once, to the people who can act, and runs once a day", async () => {
    expect(await nightly("2026-10-20")).toBeNull(); // the snapshot is 9:10am: the night's run is behind it
    expect(await nightly("2026-10-21")).toEqual({ escalated: [], expired: [], ended: [] });
    expect((await all()).map((s) => `${s.projectId} ${s.rule} ${s.subjectId} ${s.stage} ${s.level}`).sort()).toEqual([
      "forager quiet_project forager leads 1", // last report 15 Oct: 4 working days
      "forager stale_work wi-145 owner 1", // In progress since 14 Oct: 5 working days
      "insights quiet_project insights leads 4", // nothing since it started on 5 Oct
    ]);
    expect(await nightly("2026-10-21")).toBeNull();
    // On save too, nothing is raised twice: one live signal per (project, rule, subject)
    await detectSignals({ db, now: on("2026-10-21", 10) }, "forager");
    expect(await all()).toHaveLength(3);

    // Each goes to the people who can act on it, and never to anyone outside the project (P10)
    expect(await open("alicia")).toEqual(["signals:forager@2026-10-21"]);
    expect(await open("kemar")).toEqual(["signals:forager@2026-10-21"]);
    expect(await open("andre")).toEqual(["signals:insights@2026-10-21"]);
    expect(await open("jodian")).toEqual([]);
    const alicia = (await getInbox(db, "alicia", on("2026-10-21", 10))).items;
    expect(alicia.map((i) => [i.title, i.source, i.action])).toEqual([["No update on Forager 2.0 from anyone for 4 working days, since 15 Oct", "Atlas", "Review"]]);
    const kemar = (await getInbox(db, "kemar", on("2026-10-21", 10))).items;
    expect(kemar.map((i) => [i.title, i.action])).toEqual([["Is #145 Google Trends connector still going? No change or mention for 5 working days", "Answer"]]);
    expect((await getInbox(db, "andre", on("2026-10-21", 10))).items.map((i) => i.project?.id)).toEqual(["insights"]);
    // A signal is never a BRAID entry by itself (rule 1)
    expect(await db.select().from(t.braidEntries)).toHaveLength(5);
  });

  it("slipping forecast: three saves moved the forecast later; one that was undone does not count", async () => {
    const move = (captureId: string, from: string, to: string) =>
      db.insert(t.auditEntries).values({ at: on("2026-10-20"), actorType: "person", actorId: "kemar", action: "FORECAST_CHANGED", machine: "milestone", subjectType: "milestone", subjectId: "ms-trend", captureId, detail: { forecast: { from, to } } });
    await move("cap-1", "2026-10-23", "2026-10-26");
    await move("cap-2", "2026-10-26", "2026-10-28");
    await move("cap-3", "2026-10-28", "2026-10-27"); // earlier: not a slip
    await move("cap-4", "2026-10-27", "2026-11-04");
    await detectSignals({ db, now: on("2026-10-20", 10) }, "forager");
    expect(await latest("slipping_forecast", "ms-trend")).toMatchObject({ state: "raised", level: 3, episode: "2026-10-23" });
    const [shown] = await view("alicia", "2026-10-20", "slipping_forecast");
    expect(shown.text).toBe("Forecast for Trend model moved 3 times: 26 Oct, 28 Oct, 4 Nov");

    // Undoing the last save takes its slip back: the condition is gone (SG1)
    await db.insert(t.captures).values({ id: "cap-4", authorId: "kemar", channel: "app", kind: "text", text: "x", messageAt: on("2026-10-20"), receivedAt: on("2026-10-20"), dedupKey: "cap-4", state: "saved" });
    await db.insert(t.undos).values({ id: "undo-1", captureId: "cap-4", ownerId: "kemar", state: "undone" });
    await detectSignals({ db, now: on("2026-10-20", 11) }, "forager");
    expect(await latest("slipping_forecast", "ms-trend")).toMatchObject({ state: "cleared" });
  });

  it("waiting decision: a proposal still waiting after the reminders goes to its deciders; deciding it clears it (SG1)", async () => {
    const { entry } = await reportBraidEntry(as("kemar", "2026-10-20"), "forager", { kind: "risk", title: "Trend model may slip to 26 Oct" });
    await runBraidReminders({ db, now: on("2026-10-22") });
    await nightly("2026-10-26"); // 4 working days
    expect(await signal("waiting_decision", entry.id)).toEqual([]);
    await nightly("2026-10-27"); // 5
    expect(await latest("waiting_decision", entry.id)).toMatchObject({ state: "raised", stage: "leads" });
    const [shown] = await view("alicia", "2026-10-27", "waiting_decision");
    expect(shown.text).toBe(`Kemar's risk "Trend model may slip to 26 Oct" has waited 5 working days for a decision`);
    await decideBraidEntry(as("alicia", "2026-10-27", 10), entry.id, { type: "approve" });
    expect(await latest("waiting_decision", entry.id)).toMatchObject({ state: "cleared" });
    expect((await items("alicia")).filter((i) => i.causeKey === "signals:forager@2026-10-27").map((i) => i.state)).toEqual(["acted"]);
  });

  it("milestone at risk from its work: #160 past due while Production checks still shows On track", async () => {
    await nightly("2026-10-29");
    expect(await latest("milestone_at_risk", "ms-prod-checks")).toMatchObject({ state: "raised", stage: "leads", level: 1 });
    const shown = await signalsFor(db, "alicia", "forager", "2026-10-29", on("2026-10-29"));
    expect(shown.map((s) => s.text)).toContain("Production checks still shows On track, but 1 of its 1 work items are blocked or past due: #160 Feature store backfill");
  });

  it("repeated blocker: three people reported the feed blocker", async () => {
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await detectSignals({ db, now: on("2026-10-20", 10) }, "forager");
    expect(await latest("repeated_blocker", "br-feed-blocker")).toMatchObject({ state: "raised", level: 3, episode: "2026-10-14" });
    const [shown] = await view("alicia", "2026-10-20", "repeated_blocker");
    // SG5: the dependency it is linked to is no risk, so nothing covers it yet
    expect(shown).toMatchObject({ text: 'The blocker "Store sales feed access" was reported by 3 people: Alicia, Kemar and Jodian', sameAs: null, stage: "leads" });
  });
});

describe("ACCEPT and DISMISS (M29, M15)", () => {
  it("ACCEPT: a risk on the log as Alicia, its source the signal's facts; once only; not raised again unchanged", async () => {
    await nightly("2026-10-21");
    const s = await latest("quiet_project", "forager");
    const r = await acceptSignal(as("alicia", "2026-10-21", 10), s.id, { seenVersion: s.version });
    expect(r.signal).toMatchObject({ state: "accepted", decidedBy: "alicia", riskEntryId: r.entryId });
    const [risk] = await db.select().from(t.braidEntries).where(eq(t.braidEntries.id, r.entryId));
    expect(risk).toMatchObject({ kind: "risk", title: "Forager 2.0 may have stalled", state: "open", reportedBy: "alicia", decidedBy: "alicia", selfApproved: true });
    const [source] = await db.select().from(t.braidSources).where(eq(t.braidSources.entryId, r.entryId));
    expect(source).toMatchObject({ personId: "alicia", signalId: s.id, captureId: null });
    const view = await getProject(db, "alicia", "forager", on("2026-10-21", 10));
    expect(view.found && view.braid.entries.find((e) => e.id === r.entryId)?.sources[0].signal).toBe("No update on Forager 2.0 from anyone for 4 working days, since 15 Oct");
    expect(await memory("quiet_project", "forager")).toMatchObject({ answer: "accepted", level: 1, episode: "2026-10-15", by: "alicia" });
    expect((await items("alicia")).map((i) => i.state)).toEqual(["acted"]);

    // Once only: the second tap files nothing and says who answered (SG6)
    await expect(acceptSignal(as("alicia", "2026-10-21", 11), s.id)).rejects.toThrow("Alicia already accepted this as a risk");
    expect(await db.select().from(t.braidSources).where(eq(t.braidSources.signalId, s.id))).toHaveLength(1);

    // The model's fix: the next night, the same facts raise nothing; worse (another stretch of quiet) does
    await nightly("2026-10-22");
    expect(await signal("quiet_project", "forager")).toHaveLength(1);
    await nightly("2026-10-23");
    expect(await latest("quiet_project", "forager")).toMatchObject({ state: "raised", level: 2 });
  });

  it("SG5: accepted again, it is matched as the same risk an earlier signal filed (M16), and added to it", async () => {
    await nightly("2026-10-21");
    const first = await acceptSignal(as("alicia", "2026-10-21", 10), (await latest("quiet_project", "forager")).id);
    await nightly("2026-10-23");
    const again = await latest("quiet_project", "forager");
    const [shown] = (await signalsFor(db, "alicia", "forager", "2026-10-23", on("2026-10-23"))).filter((v) => v.id === again.id);
    expect(shown.sameAs).toEqual({ id: first.entryId, title: "Forager 2.0 may have stalled" });
    const r = await acceptSignal(as("alicia", "2026-10-23", 10), again.id, { seenVersion: again.version, sameAs: first.entryId });
    expect(r.entryId).toBe(first.entryId);
    expect((await db.select().from(t.braidSources).where(eq(t.braidSources.entryId, first.entryId))).map((s) => s.signalId).sort()).toEqual([again.id, (await signal("quiet_project", "forager"))[0].id].sort());
    expect((await db.select().from(t.braidEntries).where(eq(t.braidEntries.kind, "risk"))).length).toBe(2); // the pipeline risk and this one
    // Kinds never merge: the blocker it is not
    const third = await nightly("2026-10-28");
    expect(third).not.toBeNull();
    const last = await latest("quiet_project", "forager");
    await expect(acceptSignal(as("alicia", "2026-10-28", 10), last.id, { sameAs: "br-feed-blocker" })).rejects.toThrow(/cannot be added to that risk/);
  });

  it("SG5, E83: the risk the card offered was closed before the tap: a conflict; nothing is added or remembered", async () => {
    await nightly("2026-10-21");
    const first = await acceptSignal(as("alicia", "2026-10-21", 10), (await latest("quiet_project", "forager")).id);
    await nightly("2026-10-23");
    const again = await latest("quiet_project", "forager");
    const [shown] = await view("alicia", "2026-10-23", "quiet_project");
    expect(shown.sameAs?.id).toBe(first.entryId);
    await resolveBraidEntry(as("alicia", "2026-10-23", 10), first.entryId, "closed");

    await expect(acceptSignal(as("alicia", "2026-10-23", 11), again.id, { seenVersion: again.version, sameAs: first.entryId })).rejects.toThrow(
      '"Forager 2.0 may have stalled" is closed now, so nothing was added to it. Accept this as a new risk, or dismiss it',
    );
    expect(await latest("quiet_project", "forager")).toMatchObject({ id: again.id, state: "raised", version: again.version });
    const [risk] = await db.select().from(t.braidEntries).where(eq(t.braidEntries.id, first.entryId));
    expect(risk.state).toBe("closed");
    expect(await db.select().from(t.braidSources).where(eq(t.braidSources.entryId, first.entryId))).toHaveLength(1);
    expect(await memory("quiet_project", "forager")).toMatchObject({ answer: "accepted", level: 1 });

    // The card offers no risk now; accepting it files a new one
    const [now] = await view("alicia", "2026-10-23", "quiet_project");
    expect(now).toMatchObject({ id: again.id, sameAs: null });
    const r = await acceptSignal(as("alicia", "2026-10-23", 11), again.id, { seenVersion: now.version });
    expect(r.entryId).not.toBe(first.entryId);
    expect(await memory("quiet_project", "forager")).toMatchObject({ answer: "accepted", level: 2 });
  });

  it("SG5, E85: a risk declined after the card was shown is never sent back to be decided again by a tap", async () => {
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    const { entry } = await reportBraidEntry(as("kemar", "2026-10-20"), "forager", { kind: "risk", title: "Sprouts may not open the feed" });
    await db.insert(t.braidLinks).values({ entryId: entry.id, otherEntryId: "br-feed-blocker", relation: "related" });
    await detectSignals({ db, now: on("2026-10-20", 10) }, "forager");
    const [shown] = await view("alicia", "2026-10-20", "repeated_blocker");
    expect(shown.sameAs?.id).toBe(entry.id);
    await decideBraidEntry(as("alicia", "2026-10-20", 11), entry.id, { type: "decline", reason: "Kyle confirmed access" });

    await expect(acceptSignal(as("alicia", "2026-10-20", 12), shown.id, { seenVersion: shown.version, sameAs: entry.id })).rejects.toThrow('"Sprouts may not open the feed" is declined now');
    const [risk] = await db.select().from(t.braidEntries).where(eq(t.braidEntries.id, entry.id));
    expect(risk.state).toBe("declined");
    expect(await latest("repeated_blocker", "br-feed-blocker")).toMatchObject({ id: shown.id, state: "raised" });
    expect(await memory("repeated_blocker", "br-feed-blocker")).toBeUndefined();
  });

  it("SG5: a risk linked to the blocker a signal is about covers it", async () => {
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await db.insert(t.braidLinks).values({ entryId: "br-pipeline-risk", otherEntryId: "br-feed-blocker", relation: "related" });
    await detectSignals({ db, now: on("2026-10-20", 10) }, "forager");
    const [shown] = await view("alicia", "2026-10-20", "repeated_blocker");
    expect(shown.sameAs).toEqual({ id: "br-pipeline-risk", title: "Only Kemar can run the pipeline" });
    await acceptSignal(as("alicia", "2026-10-20", 11), shown.id, { sameAs: "br-pipeline-risk" });
    expect((await db.select().from(t.braidSources).where(eq(t.braidSources.entryId, "br-pipeline-risk"))).map((s) => s.personId).sort()).toEqual(["alicia", "alicia"]);
  });

  it("rule 4: only a PM or Lead it is raised to answers, with the right as it is when the answer runs", async () => {
    await nightly("2026-10-21");
    const s = await latest("quiet_project", "forager");
    await expect(acceptSignal(as("kemar", "2026-10-21", 10), s.id)).rejects.toThrow("only a PM or Lead accepts or dismisses a signal");
    await expect(acceptSignal(as("andre", "2026-10-21", 10), s.id)).rejects.toThrow(CommandRefused);
    await expect(dismissSignal(as("jodian", "2026-10-21", 10), s.id, "fine")).rejects.toThrow(CommandRefused);
    // Stale work is with its owner first: the PM has no Accept on it yet
    const st = await latest("stale_work", "wi-145");
    await expect(acceptSignal(as("alicia", "2026-10-21", 10), st.id)).rejects.toThrow("it is with its owner first");
    expect(await latest("quiet_project", "forager")).toMatchObject({ state: "raised" });
  });

  it("SG6: two PMs answer at once; the first wins and the second is told; a card made old by a refresh is refused", async () => {
    await role("forager", "jodian", "lead");
    await nightly("2026-10-21");
    const s = await latest("quiet_project", "forager");
    expect(await open("jodian")).toEqual([]); // a quiet project is the PM's
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await detectSignals({ db, now: on("2026-10-21", 10) }, "forager");
    const b = await latest("repeated_blocker", "br-feed-blocker");
    expect(await open("jodian")).toEqual(["signals:forager@2026-10-21"]);
    await acceptSignal(as("jodian", "2026-10-21", 11), b.id, { seenVersion: b.version });
    await expect(dismissSignal(as("alicia", "2026-10-21", 11), b.id, "Kyle has it", { seenVersion: b.version })).rejects.toThrow("Jodian already accepted this as a risk");
    expect(await db.select().from(t.braidSources).where(eq(t.braidSources.signalId, b.id))).toHaveLength(1);

    // Two nights later the quiet project is worse: REFRESH moves its version, so a card shown before is out of date
    await nightly("2026-10-23");
    const refreshed = await latest("quiet_project", "forager");
    expect(refreshed).toMatchObject({ id: s.id, level: 2, version: s.version + 1 });
    await expect(dismissSignal(as("alicia", "2026-10-23", 10), s.id, "fine", { seenVersion: s.version })).rejects.toThrow(StaleVersion);
  });

  it("SG6, rule 5: a signal whose stored level is behind the facts is answered with the version the card shows, also after a refusal", async () => {
    await nightly("2026-10-21");
    const s = await latest("quiet_project", "forager");
    // 23 Oct, before any run: the 21 Oct card shows the facts as they are now, and the stored version
    const [shown] = await signalsFor(db, "alicia", "forager", "2026-10-21", on("2026-10-23"));
    expect(shown).toMatchObject({ id: s.id, version: s.version, text: "No update on Forager 2.0 from anyone for 6 working days, since 15 Oct" });
    expect(await latest("quiet_project", "forager")).toMatchObject({ level: 1, version: s.version });
    // A refusal rolls back the answer's REFRESH with everything else; the retry with the same version still runs
    await expect(acceptSignal(as("alicia", "2026-10-23", 10), s.id, { seenVersion: shown.version, sameAs: "br-pipeline-risk" })).rejects.toThrow(CommandRefused);
    expect(await latest("quiet_project", "forager")).toMatchObject({ level: 1, version: s.version });
    const r = await dismissSignal(as("alicia", "2026-10-23", 10), s.id, "Between sprints", { seenVersion: shown.version });
    expect(r.signal).toMatchObject({ state: "dismissed", level: 2 });
    expect(await memory("quiet_project", "forager")).toMatchObject({ answer: "dismissed", level: 2 });
  });

  it("SG3: dismissed, and it stays the same: not raised again within the snooze, nor after it", async () => {
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await detectSignals({ db, now: on("2026-10-20", 10) }, "forager");
    const s = await latest("repeated_blocker", "br-feed-blocker");
    await expect(dismissSignal(as("alicia", "2026-10-20", 11), s.id, "  ")).rejects.toThrow("say why you dismiss it");
    await dismissSignal(as("alicia", "2026-10-20", 11), s.id, "Kyle is chasing it", { seenVersion: s.version });
    expect(await memory("repeated_blocker", "br-feed-blocker")).toMatchObject({ answer: "dismissed", level: 3, reason: "Kyle is chasing it" });
    expect(await view("alicia", "2026-10-20", "repeated_blocker")).toEqual([]);
    await nightly("2026-10-26");
    expect(await latest("repeated_blocker", "br-feed-blocker")).toMatchObject({ id: s.id, state: "dismissed" });
    await nightly("2026-10-27"); // 7 days: the snooze ends, and the same facts raise nothing
    expect(await signal("repeated_blocker", "br-feed-blocker")).toEqual([expect.objectContaining({ id: s.id, state: "ended" })]);
    await nightly("2026-10-28");
    expect(await signal("repeated_blocker", "br-feed-blocker")).toHaveLength(1);
  });

  it("SG2: dismissed, then it gets worse: raised again after the snooze, with the dismissal reason shown", async () => {
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await detectSignals({ db, now: on("2026-10-20", 10) }, "forager");
    const s = await latest("repeated_blocker", "br-feed-blocker");
    await dismissSignal(as("alicia", "2026-10-20", 11), s.id, "Kyle is chasing it");
    await reports("br-feed-blocker", [["kemar", "2026-10-22T14:00:00Z"]]);
    await nightly("2026-10-23");
    expect(await signal("repeated_blocker", "br-feed-blocker")).toHaveLength(1); // as drawn, it waits for the snooze
    await nightly("2026-10-27");
    const again = await latest("repeated_blocker", "br-feed-blocker");
    expect(again).toMatchObject({ state: "raised", level: 4, earlier: { by: "alicia", on: "2026-10-20", reason: "Kyle is chasing it" } });
    const shown = await signalsFor(db, "alicia", "forager", "2026-10-27", on("2026-10-27"));
    expect(shown.find((v) => v.id === again.id)?.earlier).toBe('Alicia dismissed this on 20 Oct: "Kyle is chasing it"');
  });

  it("the model's fix: a condition that ends and comes back is a new episode, raised again at the same level", async () => {
    await nightly("2026-10-29");
    const s = await latest("milestone_at_risk", "ms-prod-checks");
    await dismissSignal(as("alicia", "2026-10-29", 10), s.id, "Jodian is finishing it");
    // #160's due date moves out and back: the run in between sees the condition end
    await db.update(t.workItems).set({ dueDate: "2026-11-30" }).where(eq(t.workItems.id, "wi-160"));
    await nightly("2026-11-05");
    expect(await memory("milestone_at_risk", "ms-prod-checks")).toMatchObject({ seenGone: true });
    expect(await signal("milestone_at_risk", "ms-prod-checks")).toHaveLength(1);
    await db.update(t.workItems).set({ dueDate: "2026-10-28" }).where(eq(t.workItems.id, "wi-160"));
    await nightly("2026-11-06");
    expect(await latest("milestone_at_risk", "ms-prod-checks")).toMatchObject({ state: "raised", level: 1 });
    expect(await signal("milestone_at_risk", "ms-prod-checks")).toHaveLength(2);
  });
});

describe("stale work: its owner first, then PM and Leads", () => {
  it("SG8: the owner answers \"still going\"; the clock restarts and nothing reaches the PM", async () => {
    await nightly("2026-10-21");
    const s = await latest("stale_work", "wi-145");
    // Rule 10: Alicia saying Kemar's still on it changes nothing of his
    await expect(stillGoing(as("alicia", "2026-10-21", 10), "wi-145")).rejects.toThrow("only Kemar says whether #145 is still going");
    await stillGoing(as("kemar", "2026-10-21", 10), "wi-145");
    expect(await latest("stale_work", "wi-145")).toMatchObject({ id: s.id, state: "cleared" });
    expect((await items("kemar")).map((i) => i.state)).toEqual(["acted"]);
    const [work] = await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-145"));
    expect(work).toMatchObject({ state: "in_progress", version: 1 }); // nothing about the item changed
    await nightly("2026-10-23");
    expect(await signal("stale_work", "wi-145")).toHaveLength(1);
    expect(await open("alicia")).not.toContain("signals:forager@2026-10-23");
  });

  it("the model's fix: no answer in ownerAnswerDays, it goes to PM and Leads, and expires signalExpiryDays after that", async () => {
    await nightly("2026-10-21");
    const s = await latest("stale_work", "wi-145");
    await nightly("2026-10-22");
    expect(await latest("stale_work", "wi-145")).toMatchObject({ stage: "owner" });
    expect(await nightly("2026-10-23")).toMatchObject({ escalated: [s.id] });
    expect(await latest("stale_work", "wi-145")).toMatchObject({ stage: "leads", stageOn: "2026-10-23", raisedOn: "2026-10-21" });
    // The owner's copy closes; the PM's arrives with that day's other signals (SG10)
    expect((await items("kemar")).find((i) => i.causeKey === "signals:forager@2026-10-21")?.state).toBe("auto_closed");
    expect(await open("alicia")).toContain("signals:forager@2026-10-23");
    const shown = await signalsFor(db, "alicia", "forager", "2026-10-23", on("2026-10-23"));
    expect(shown.find((v) => v.id === s.id)?.text).toBe("#145 Google Trends connector has been In progress for 7 working days with no change and no mention in any update");
    // Kemar is on leave 26 to 30 Oct; the PM still has it. Two weeks after it reached her, it expires and is remembered
    expect((await nightly("2026-11-05"))!.expired).not.toContain(s.id);
    expect((await nightly("2026-11-06"))!.expired).toContain(s.id);
    const expired = await latest("stale_work", "wi-145");
    expect(expired.state).toBe("expired");
    expect(await memory("stale_work", "wi-145")).toMatchObject({ answer: "expired", level: expired.level, episode: "2026-10-14" });
    await nightly("2026-11-09");
    expect(await signal("stale_work", "wi-145")).toHaveLength(1);
  });

  it("SG4: stale work owned by someone on leave is not raised while they are away", async () => {
    await nightly("2026-10-26"); // Kemar is away 26 to 30 Oct
    expect(await signal("stale_work", "wi-145")).toEqual([]);
    await nightly("2026-10-30");
    expect(await signal("stale_work", "wi-145")).toEqual([]);
    await nightly("2026-11-02");
    expect(await latest("stale_work", "wi-145")).toMatchObject({ state: "raised", stage: "owner" });
  });
});

describe("on save", () => {
  /** Kemar saves an update on Forager that says #145 is still going (no change) and #151 is blocked. */
  async function kemarSaves(day: string) {
    const text = "Still on the Google Trends connector. Still waiting on Kyle for the store feed";
    const ctx = as("kemar", day);
    const proposals: RawProposal[] = [
      { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#145", label: "#145" }, targetId: "wi-145", field: "state", newValue: "in_progress", quote: "Still on the Google Trends connector", confidence: "high", rationale: "still going" },
      { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#151", label: "#151" }, targetId: "wi-151", field: "state", newValue: "blocked", note: "waiting on Kyle", quote: "Still waiting on Kyle for the store feed", confidence: "high", rationale: "blocked" },
    ];
    const { captureId } = await createCapture(ctx, { channel: "app", kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, messageId: `save-${day}` });
    const { items } = await proposeItems(ctx, captureId, proposals);
    await openReview(ctx, captureId);
    for (const i of items) if (i.state === "needs_ok") await decideExtraction(ctx, i.id, { type: "accept" });
    const saved = await saveCapture(ctx, captureId);
    if (saved.outcome !== "saved") throw new Error(`save: ${JSON.stringify(saved)}`);
  }

  it("a saved update clears what it answers (a mention, an update) and looks for new trouble", async () => {
    await nightly("2026-10-21");
    expect((await all()).filter((s) => s.projectId === "forager").map((s) => s.rule).sort()).toEqual(["quiet_project", "stale_work"]);
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await kemarSaves("2026-10-22");
    // #145 was mentioned and Forager has an update today; the blocker three people reported is raised on save
    expect(await latest("stale_work", "wi-145")).toMatchObject({ state: "cleared" });
    expect(await latest("quiet_project", "forager")).toMatchObject({ state: "cleared" });
    expect(await latest("repeated_blocker", "br-feed-blocker")).toMatchObject({ state: "raised", raisedOn: "2026-10-22" });
    // #151 has been In progress since 15 Oct but is Blocked now, so it is not stale
    expect(await signal("stale_work", "wi-151")).toEqual([]);
  });

  it("repeated blocker: Alicia resolves the feed blocker, and Kemar's saved update reports it again (S14): raised on that save", async () => {
    await resolveBraidEntry(as("alicia", "2026-10-20", 10), "br-feed-blocker");
    await detectSignals({ db, now: on("2026-10-20", 11) }, "forager");
    expect(await signal("repeated_blocker", "br-feed-blocker")).toEqual([]); // one reporter, and not reported again yet

    const ctx = as("kemar", "2026-10-22");
    const proposal: RawProposal = {
      kind: "braid_same",
      projectId: "forager",
      routingReason: { basis: "target", evidence: "store feed", label: "Same subject" },
      braidKind: "blocker",
      matchEntryId: "br-feed-blocker",
      quote: "Still no access to the store sales feed",
      confidence: "high",
      rationale: "Reported again",
    };
    const { captureId } = await createCapture(ctx, { channel: "app", kind: "text", text: "Still no access to the store sales feed.", messageAt: ctx.now, receivedAt: ctx.now, messageId: "save-reopen" });
    const { items } = await proposeItems(ctx, captureId, [proposal]);
    await openReview(ctx, captureId);
    for (const i of items) if (i.state === "needs_ok") await decideExtraction(ctx, i.id, { type: "accept" });
    expect((await saveCapture(ctx, captureId)).outcome).toBe("saved");

    // The save's own audit row (resolved to reported) is what the rule reads: two reporters, but reopened
    const [blocker] = await db.select().from(t.braidEntries).where(eq(t.braidEntries.id, "br-feed-blocker"));
    expect(blocker.state).toBe("reported");
    expect(await latest("repeated_blocker", "br-feed-blocker")).toMatchObject({ state: "raised", raisedOn: "2026-10-22", stage: "leads" });
    const [shown] = await view("alicia", "2026-10-22", "repeated_blocker");
    expect(shown.text).toBe('The blocker "Store sales feed access" was reported again on 22 Oct after it was resolved');
  });
});

describe("SG1, SG7, SG9, SG10", () => {
  it("SG1: an update arrives before anyone answers; the signal clears and the inbox item closes as cause gone", async () => {
    await nightly("2026-10-21");
    await reportBraidEntry(as("kemar", "2026-10-21", 10), "forager", { kind: "issue", title: "Trends quota hit again" });
    expect(await latest("quiet_project", "forager")).toMatchObject({ state: "cleared" });
    expect((await items("alicia")).map((i) => i.state)).toEqual(["auto_closed"]);
    await expect(acceptSignal(as("alicia", "2026-10-21", 11), (await latest("quiet_project", "forager")).id)).rejects.toThrow("what this noticed is no longer true");
  });

  it("CONDITION_GONE is checked on read: a gone condition is not shown even before a run clears it", async () => {
    await nightly("2026-10-21");
    await db.insert(t.braidSources).values({ id: "src-new", entryId: "br-pipeline-risk", originEntryId: "br-pipeline-risk", personId: "kemar", at: on("2026-10-21", 10) });
    expect(await latest("quiet_project", "forager")).toMatchObject({ state: "raised" });
    expect((await getInbox(db, "alicia", on("2026-10-21", 11))).items).toEqual([]);
  });

  it("SG7 and CD13: the PM marks a project paused; its quiet signal clears and no other is raised", async () => {
    await nightly("2026-10-21");
    await expect(setProjectPaused(as("kemar", "2026-10-21", 10), "forager", true)).rejects.toThrow("only the project's PM marks it paused");
    await setProjectPaused(as("alicia", "2026-10-21", 10), "forager", true);
    expect(await latest("quiet_project", "forager")).toMatchObject({ state: "cleared" });
    await expect(setProjectPaused(as("alicia", "2026-10-21", 10), "forager", true)).rejects.toThrow("it is already paused");
    await nightly("2026-10-27");
    expect(await signal("quiet_project", "forager")).toHaveLength(1);
    const view = await getProject(db, "alicia", "forager", on("2026-10-27"));
    expect(view.found && view.project.paused).toBe(true);
    await setProjectPaused(as("alicia", "2026-10-27", 10), "forager", false);
    await detectSignals({ db, now: on("2026-10-27", 11) }, "forager");
    expect(await latest("quiet_project", "forager")).toMatchObject({ state: "raised" });
  });

  it("SG9: a PM who has since left loses their copy and their right; the Lead still has it", async () => {
    await role("forager", "jodian", "lead");
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await detectSignals({ db, now: on("2026-10-20", 10) }, "forager");
    const s = await latest("repeated_blocker", "br-feed-blocker");
    expect(await open("alicia")).toEqual(["signals:forager@2026-10-20"]);
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    await detectSignals({ db, now: on("2026-10-20", 11) }, "forager");
    expect(await open("alicia")).toEqual([]);
    expect(await open("jodian")).toEqual(["signals:forager@2026-10-20"]);
    expect(await signalsFor(db, "alicia", "forager", "2026-10-20", on("2026-10-20", 11))).toEqual([]);
    await expect(acceptSignal(as("alicia", "2026-10-20", 11), s.id)).rejects.toThrow(CommandRefused);
    await acceptSignal(as("jodian", "2026-10-20", 11), s.id);
  });

  it("SG10: many signals at once on one project are one inbox item per project per day", async () => {
    await reports("br-feed-blocker", [
      ["kemar", "2026-10-15T13:58:00Z"],
      ["jodian", "2026-10-15T14:30:00Z"],
    ]);
    await nightly("2026-10-21");
    expect(await open("alicia")).toEqual(["signals:forager@2026-10-21"]);
    const [item] = (await getInbox(db, "alicia", on("2026-10-21", 10))).items;
    expect(item).toMatchObject({ title: "Atlas noticed 2 things on Forager 2.0", subject: { type: "signals", projectId: "forager", day: "2026-10-21" } });
    // Answering one leaves the item open for the other; the last answer closes it as acted
    const shown = await signalsFor(db, "alicia", "forager", "2026-10-21", on("2026-10-21", 10));
    expect(shown.map((s) => s.rule).sort()).toEqual(["quiet_project", "repeated_blocker"]);
    await dismissSignal(as("alicia", "2026-10-21", 10), shown[0].id, "known");
    expect(await open("alicia")).toEqual(["signals:forager@2026-10-21"]);
    await acceptSignal(as("alicia", "2026-10-21", 10), shown[1].id);
    expect((await items("alicia")).map((i) => i.state)).toEqual(["acted"]);
  });
});
