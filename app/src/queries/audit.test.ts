import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { at, seededDb } from "../test/seeded-db";
import { getAuditTrail, type AuditTrail } from "./audit";
import { NOT_YOURS } from "./project";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

const CAPTURE = "cap-kemar-0858";

async function trail(viewer: string, subject: Parameters<typeof getAuditTrail>[2]): Promise<AuditTrail> {
  const r = await getAuditTrail(db, viewer, subject);
  if (!r.found) throw new Error(`${viewer} should see the trail of ${subject.type} ${subject.id}`);
  return r;
}

// What Kemar's save would write: a record change that carries the capture, and a BRAID source added
async function kemarSaved() {
  await db.insert(t.auditEntries).values([
    { at: at(0), actorType: "person", actorId: "kemar", action: "SAVE", machine: "capture", subjectType: "capture", subjectId: CAPTURE, fromState: "reviewing", toState: "saving", captureId: CAPTURE },
    { at: at(0), actorType: "person", actorId: "kemar", action: "APPLIED", machine: "extracted_item", subjectType: "extraction", subjectId: `${CAPTURE}-2`, fromState: "pre_accepted", toState: "applied", captureId: CAPTURE, extractionId: `${CAPTURE}-2` },
    { at: at(0), actorType: "person", actorId: "kemar", action: "COMPLETE", machine: "work_item", subjectType: "work_item", subjectId: "wi-145", fromState: "in_progress", toState: "done", captureId: CAPTURE, extractionId: `${CAPTURE}-2` },
    { at: at(0), actorType: "person", actorId: "kemar", action: "COMPLETE", machine: "work_item", subjectType: "work_item", subjectId: "wi-208", fromState: "in_progress", toState: "done", captureId: CAPTURE, extractionId: `${CAPTURE}-10` },
    { at: at(0), actorType: "person", actorId: "kemar", action: "ADD_SOURCE", machine: "braid_entry", subjectType: "braid_entry", subjectId: "br-feed-blocker", fromState: "reported", toState: "reported", captureId: CAPTURE, extractionId: `${CAPTURE}-7` },
  ]);
}

describe("getAuditTrail: a project, for its members", () => {
  it("Alicia's 9:02 set status, newest first, with no capture or inbox rows", async () => {
    const r = await trail("alicia", { type: "project", id: "forager" });
    expect(r.entries.map((e) => [e.action, e.subject.type, e.actor.name, e.from, e.to])).toEqual([["OWNER_SETS", "project", "Alicia Campbell", "calculated_only", "reason_required"]]);
  });

  it("after Kemar saves: Forager's records only, never Store Insights' or the capture's own rows", async () => {
    await kemarSaved();
    const r = await trail("alicia", { type: "project", id: "forager" });
    expect(r.entries.map((e) => [e.action, e.subject.id])).toEqual([
      ["ADD_SOURCE", "br-feed-blocker"],
      ["COMPLETE", "wi-145"],
      ["OWNER_SETS", "forager"],
    ]);
    expect(r.entries[0].at.getTime()).toBeGreaterThan(r.entries[2].at.getTime());
    const andre = await trail("andre", { type: "project", id: "insights" });
    expect(andre.entries.map((e) => [e.action, e.subject.id])).toEqual([["COMPLETE", "wi-208"]]);
  });

  it("a non-member gets the same answer as for no project", async () => {
    expect(await getAuditTrail(db, "andre", { type: "project", id: "forager" })).toEqual(NOT_YOURS);
    expect(await getAuditTrail(db, "alicia", { type: "project", id: "nowhere" })).toEqual(NOT_YOURS);
  });
});

describe("getAuditTrail: a BRAID entry, for members of its project", () => {
  it("Alicia sees the blocker's trail; Andre does not", async () => {
    await kemarSaved();
    const r = await trail("alicia", { type: "braid_entry", id: "br-feed-blocker" });
    expect(r.entries.map((e) => [e.action, e.actor.name, e.extractionId])).toEqual([["ADD_SOURCE", "Kemar Brown", `${CAPTURE}-7`]]);
    expect(await getAuditTrail(db, "andre", { type: "braid_entry", id: "br-feed-blocker" })).toEqual(NOT_YOURS);
    expect(await getAuditTrail(db, "andre", { type: "braid_entry", id: "br-nope" })).toEqual(NOT_YOURS);
  });
});

describe("getAuditTrail: a capture, for its author only (M1)", () => {
  it("Kemar sees his capture's trail, newest first", async () => {
    const before = await trail("kemar", { type: "capture", id: CAPTURE });
    expect(before.entries.map((e) => [e.action, e.actor.type])).toEqual([
      ["PROPOSALS_READY", "atlas"],
      ["RECEIVED", "system"],
    ]);
    await kemarSaved();
    const after = await trail("kemar", { type: "capture", id: CAPTURE });
    expect(after.entries.map((e) => e.action)).toEqual(["ADD_SOURCE", "COMPLETE", "COMPLETE", "APPLIED", "SAVE", "PROPOSALS_READY", "RECEIVED"]);
  });

  it("nobody else reads it", async () => {
    expect(await getAuditTrail(db, "alicia", { type: "capture", id: CAPTURE })).toEqual(NOT_YOURS);
    expect(await getAuditTrail(db, "andre", { type: "capture", id: CAPTURE })).toEqual(NOT_YOURS);
    expect(await getAuditTrail(db, "kemar", { type: "capture", id: "cap-nope" })).toEqual(NOT_YOURS);
  });
});
