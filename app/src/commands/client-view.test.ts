// Decision CD49 (W3-D11) against PGlite: the project's PM turns an outside contact's client view on or off,
// checked when it runs, audited, per project; the contact's next question reads the switch (phase Q, EX4);
// a refusal names nothing about a project the actor cannot open (P10).
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { switchClientView } from "../domain/machines/client-view";
import { answerFor } from "../queries/answer";
import { NOT_FOUND } from "../queries/answers/explain-project";
import { getAuditTrail } from "../queries/audit";
import { contactsOf } from "../queries/client-view";
import { at, seededDb } from "../test/seeded-db";
import { setClientView, writeClientView } from "./client-view";
import { CommandRefused, StaleVersion } from "./core";
import { decideVocabularyChange, proposeVocabularyChange } from "./vocabulary";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const kyleAsks = async (what: string, minutes = 10) => (await answerFor(db, "kyle", { asked: `What is ${what}?`, topic: "explain_project", projectId: null }, at(minutes))).text;
const flag = async (projectId: string, personId = "kyle") =>
  (await db.select().from(t.projectContacts).where(and(eq(t.projectContacts.projectId, projectId), eq(t.projectContacts.personId, personId))))[0]?.clientView;
const trail = () => db.select().from(t.auditEntries).where(eq(t.auditEntries.machine, "client_view"));
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected a refusal");
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(CommandRefused);
      return { reason: (e as CommandRefused).reason, code: (e as CommandRefused).code };
    },
  );
const FORAGER_VIEW = "Forager 2.0 is for Sprouts, from Mon 12 Oct to Fri 6 Nov. Its releases are";

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("a PM turns a contact's client view on or off (CD49)", () => {
  it("Alicia turns Kyle's off: his next question finds nothing; on again, he reads the client view", async () => {
    expect(await kyleAsks("Forager")).toMatch(new RegExp(`^${FORAGER_VIEW}`));
    expect(await setClientView(as("alicia", 1), "forager", "kyle", false)).toEqual({ projectId: "forager", personId: "kyle", state: "off" });
    expect(await flag("forager")).toBe(false);
    // Immediately: the very next answer reads the switch, with no client view at all
    expect(await kyleAsks("Forager", 2)).toBe(NOT_FOUND);
    await setClientView(as("alicia", 3), "forager", "kyle", true);
    expect(await kyleAsks("Forager", 4)).toMatch(new RegExp(`^${FORAGER_VIEW}`));
    // Every move is audited, its subject the contact on the project
    expect((await trail()).map((a) => [a.actorId, a.action, a.subjectType, a.subjectId, a.fromState, a.toState, a.detail])).toEqual([
      ["alicia", "TURN_OFF", "project_contact", "forager@kyle", "on", "off", { projectId: "forager", personId: "kyle" }],
      ["alicia", "TURN_ON", "project_contact", "forager@kyle", "off", "on", { projectId: "forager", personId: "kyle" }],
    ]);
  });

  it("rule 5: a move over a flag that changed since it was read is stale; nothing is written or audited", async () => {
    // A screen read Kyle's as off, but it is on now (another tab, or another PM, moved it first)
    const stale = switchClientView({ projectId: "forager", personId: "kyle", state: "off" }, { type: "TURN_ON" }, "alicia", { byPm: true, outside: true });
    await expect(db.transaction((tx) => writeClientView(tx, at(1), stale, "Kyle's client view on Forager 2.0"))).rejects.toBeInstanceOf(StaleVersion);
    expect(await flag("forager")).toBe(true);
    expect(await trail()).toEqual([]);
    // The same move over the flag as it is goes through, once
    const fresh = switchClientView({ projectId: "forager", personId: "kyle", state: "on" }, { type: "TURN_OFF" }, "alicia", { byPm: true, outside: true });
    await db.transaction((tx) => writeClientView(tx, at(2), fresh, "Kyle's client view on Forager 2.0"));
    await expect(db.transaction((tx) => writeClientView(tx, at(3), fresh, "Kyle's client view on Forager 2.0"))).rejects.toBeInstanceOf(StaleVersion);
    expect(await flag("forager")).toBe(false);
    expect((await trail()).map((a) => [a.action, a.fromState, a.toState])).toEqual([["TURN_OFF", "on", "off"]]);
  });

  it("each contact's switch is its own subject, on its own project's trail only", async () => {
    await db.insert(t.people).values({ id: "dana", name: "Dana Reid", initials: "DR", title: "Sprouts Ops", orgRole: null });
    await db.insert(t.projectContacts).values([
      { projectId: "forager", personId: "dana", tie: "contact (Sprouts Ops)" },
      { projectId: "insights", personId: "kyle", tie: "contact (Sprouts IT)" },
    ]);
    await setClientView(as("alicia", 1), "forager", "dana", true);
    await setClientView(as("alicia", 2), "forager", "kyle", false);
    await setClientView(as("andre", 3), "insights", "kyle", true);
    expect((await trail()).map((a) => a.subjectId)).toEqual(["forager@dana", "forager@kyle", "insights@kyle"]);
    // Read by subject, as whatChanged and onlyBookkeepingSince read one: Dana's switch is not Kyle's
    const kyleOnForager = await db
      .select()
      .from(t.auditEntries)
      .where(and(eq(t.auditEntries.subjectType, "project_contact"), eq(t.auditEntries.subjectId, "forager@kyle")));
    expect(kyleOnForager.map((a) => [a.action, a.detail])).toEqual([["TURN_OFF", { projectId: "forager", personId: "kyle" }]]);
    // The project's trail has its own contacts' moves, for its members; never another project's
    const ofProject = async (viewer: string, projectId: string) => {
      const r = await getAuditTrail(db, viewer, { type: "project", id: projectId });
      return r.found ? r.entries.filter((e) => e.machine === "client_view").map((e) => e.subject.id) : r;
    };
    expect(await ofProject("kemar", "forager")).toEqual(["forager@kyle", "forager@dana"]);
    expect(await ofProject("andre", "insights")).toEqual(["insights@kyle"]);
  });

  it("rule 6: turning it on when it is on changes nothing and says so", async () => {
    expect(await refusal(setClientView(as("alicia"), "forager", "kyle", true))).toEqual({ reason: "Kyle's client view is already on", code: "refused" });
    expect(await trail()).toEqual([]);
  });

  it("a member who is not the PM is refused, and nothing changes (rule 4)", async () => {
    for (const [who, on] of [["kemar", false], ["jodian", false]] as const) {
      expect(await refusal(setClientView(as(who), "forager", "kyle", on))).toEqual({ reason: "only the project's PM turns a contact's client view on or off", code: "not_allowed" });
    }
    // A Lead is not the PM either
    await db.update(t.projectMemberships).set({ role: "lead" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "kemar")));
    expect((await refusal(setClientView(as("kemar"), "forager", "kyle", false))).code).toBe("not_allowed");
    expect(await flag("forager")).toBe(true);
    expect(await trail()).toEqual([]);
  });

  it("a PM who left is refused when it runs, though the button was on her screen (rule 7, P10)", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    expect(await refusal(setClientView(as("alicia"), "forager", "kyle", false))).toEqual({ reason: "not one of your projects", code: "not_found" });
    expect(await flag("forager")).toBe(true);
    expect(await kyleAsks("Forager")).toMatch(new RegExp(`^${FORAGER_VIEW}`));
  });

  it("a contact on two projects is switched per project, each by its own PM", async () => {
    // Store Insights ties Kyle as a contact too; a new tie starts off
    await db.insert(t.projectContacts).values({ projectId: "insights", personId: "kyle", tie: "contact (Sprouts IT)" });
    expect(await flag("insights")).toBe(false);
    expect(await kyleAsks("Store Insights")).toBe(`${NOT_FOUND} You can ask about Forager 2.0.`);

    await setClientView(as("andre", 1), "insights", "kyle", true);
    expect(await kyleAsks("Store Insights", 2)).toMatch(/^Store Insights is for Sprouts, from Mon 5 Oct to Fri 18 Dec\./);
    await setClientView(as("alicia", 3), "forager", "kyle", false);
    expect([await flag("forager"), await flag("insights")]).toEqual([false, true]);
    expect(await kyleAsks("Forager", 4)).toBe(`${NOT_FOUND} You can ask about Store Insights.`);
    expect(await kyleAsks("Store Insights", 4)).toMatch(/^Store Insights is for Sprouts/);
    // Each project's members see their own contact row only
    expect((await contactsOf(db, "andre", "insights")).map((c) => [c.person.id, c.clientView])).toEqual([["kyle", true]]);
    expect((await contactsOf(db, "alicia", "forager")).map((c) => [c.person.id, c.clientView])).toEqual([["kyle", false]]);
  });

  it("P10: a PM asking about a project she cannot open hears the same words whatever is true of it", async () => {
    await db.insert(t.projectContacts).values({ projectId: "insights", personId: "kyle", tie: "contact (Sprouts IT)" });
    // Kyle is a contact on Store Insights; Kemar is a member there, not a contact; nobody is on a project that does not exist
    const asked = [
      await refusal(setClientView(as("alicia"), "insights", "kyle", true)),
      await refusal(setClientView(as("alicia"), "insights", "kemar", true)),
      await refusal(setClientView(as("alicia"), "nowhere", "kyle", true)),
    ];
    for (const r of asked) expect(r).toEqual({ reason: "not one of your projects", code: "not_found" });
    for (const word of ["Store Insights", "Andre", "Kyle", "Sprouts", "contact"]) expect(JSON.stringify(asked), word).not.toContain(word);
    expect(await flag("insights")).toBe(false);
    // On her own project, someone who is not a contact there is not named either
    expect(await refusal(setClientView(as("alicia"), "forager", "andre", true))).toEqual({ reason: "they are not a contact on this project", code: "not_found" });
  });

  it("someone in the org has no client view to turn on", async () => {
    await db.insert(t.projectContacts).values({ projectId: "gq", personId: "jodian", tie: "contact" });
    expect(await refusal(setClientView(as("alicia"), "gq", "jodian", true))).toEqual({
      reason: "only an outside contact has a client view; someone in the org reads the project as a member",
      code: "refused",
    });
    expect((await contactsOf(db, "alicia", "gq")).map((c) => [c.person.id, c.outside, c.clientView])).toEqual([["jodian", false, false]]);
  });

  it("a contact taken off and added back through a correction starts off again", async () => {
    const decided = async (input: Parameters<typeof proposeVocabularyChange>[2], minutes: number) => {
      const proposal = await db.transaction((tx) => proposeVocabularyChange(tx, at(minutes), input));
      if (proposal.kind !== "change") throw new Error("expected a change");
      await decideVocabularyChange(as("alicia", minutes), proposal.change.id, "approve");
    };
    await decided({ projectId: "forager", kind: "contact", personId: "kyle", remove: true, proposedBy: "kemar", forId: "kemar" }, 1);
    expect(await flag("forager")).toBeUndefined();
    await decided({ projectId: "forager", kind: "contact", personId: "kyle", proposedBy: "kemar", forId: "kemar" }, 2);
    expect(await flag("forager")).toBe(false);
    expect(await kyleAsks("Forager", 3)).toBe(NOT_FOUND);
  });
});

describe("the project's contacts as its members see them", () => {
  it("every member reads Kyle's tie and whether he can see the client view; someone off the project reads none", async () => {
    for (const who of ["alicia", "kemar", "jodian"]) {
      expect(await contactsOf(db, who, "forager"), who).toEqual([{ person: { id: "kyle", name: "Kyle", title: "Sprouts IT" }, tie: "contact on #151 (Sprouts IT)", outside: true, clientView: true }]);
    }
    expect(await contactsOf(db, "andre", "forager")).toEqual([]);
    expect(await contactsOf(db, "kyle", "forager")).toEqual([]);
    await db.update(t.groups).set({ connectedToDpm: false }).where(eq(t.groups.id, "g-forager"));
    expect(await contactsOf(db, "alicia", "forager")).toEqual([]);
  });
});
