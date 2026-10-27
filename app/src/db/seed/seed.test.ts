import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { KEMAR_CONTEXT } from "../../domain/atlas-checks/kemar-note.fixture";
import { candidateProjects } from "../../domain/machines/membership";
import { displayedStatus, type SetStatusRecord } from "../../domain/machines/set-status";
import { calculatePlan } from "../../domain/status/rules";
import { openPglite, type Db } from "../client";
import * as t from "../schema";
import { seedSnapshot, type SeedSummary } from "./seed";
import { SNAPSHOT } from "./snapshot";

let db: Db;
let summary: SeedSummary;

beforeAll(async () => {
  const opened = openPglite();
  await opened.migrate();
  db = opened.db;
  summary = await seedSnapshot(db);
});

async function foragerCalculated() {
  const [threads, milestones, workItems] = await Promise.all([
    db.select().from(t.threads).where(eq(t.threads.projectId, "forager")),
    db.select().from(t.milestones).where(eq(t.milestones.projectId, "forager")),
    db.select().from(t.workItems).where(eq(t.workItems.projectId, "forager")),
  ]);
  return calculatePlan({ threads, milestones, workItems }, SNAPSHOT.today);
}

describe("the 20 Oct snapshot (phase 2 done when)", () => {
  it("Forager 2.0 is calculated On track from its rows, and every thread is On track", async () => {
    const plan = await foragerCalculated();
    expect(plan).toEqual({ threads: { "th-trend": "on_track", "th-store": "on_track", "th-prod": "on_track" }, project: "on_track" });
    expect(summary.foragerCalculated).toBe("on_track");
  });

  it("Alicia's 9:02 set status: Off track, waiting for a reason, and the screen still shows the plan", async () => {
    const [p] = await db.select().from(t.projects).where(eq(t.projects.id, "forager"));
    expect(p).toMatchObject({ setStatus: "off_track", setOverride: "reason_required", setBy: "alicia" });
    const record: SetStatusRecord = { override: p.setOverride, setStatus: p.setStatus, reasonGivenAt: null };
    expect(displayedStatus(record, "on_track")).toBe("on_track"); // NoSilentDisagreement: no reason yet
  });

  it("exactly one open inbox item, Alicia's", async () => {
    const items = await db.select().from(t.inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ownerId: "alicia", causeKey: "status_set_with_no_reason:forager", episode: 1, state: "open" });
  });

  it("the store feed blocker is on the log with 1 report", async () => {
    const [blocker] = await db.select().from(t.braidEntries).where(eq(t.braidEntries.id, "br-feed-blocker"));
    expect(blocker).toMatchObject({ kind: "blocker", state: "reported", ownerId: "kemar" });
    expect(await db.select().from(t.braidSources).where(eq(t.braidSources.entryId, "br-feed-blocker"))).toHaveLength(1);
  });

  it("Kemar's note waits for review as 11 items: 9 updates for 2 projects, 4 need his OK", async () => {
    const [capture] = await db.select().from(t.captures);
    expect(capture).toMatchObject({ authorId: "kemar", state: "proposed", proposals: 11, channel: "whatsapp", kind: "voice" });
    const items = await db.select().from(t.extractions).where(eq(t.extractions.captureId, capture.id));
    expect(items).toHaveLength(11);
    const changes = items.filter((i) => i.draft.mark !== "no_change" && i.draft.mark !== "matches_leave");
    expect(changes).toHaveLength(9);
    expect(new Set(changes.map((i) => i.projectId).filter(Boolean))).toEqual(new Set(["forager", "insights"]));
    expect(items.filter((i) => i.state === "needs_ok").map((i) => i.ordinal).sort((a, b) => a - b)).toEqual([4, 6, 8, 9]);
  });

  it("Kemar can file into his 3 project groups, not the Data guild or his study group", async () => {
    const [memberships, groups, projects] = await Promise.all([
      db.select().from(t.projectMemberships),
      db.select().from(t.groups),
      db.select().from(t.projects),
    ]);
    const world = {
      memberships,
      projects: projects.map((p) => {
        const g = groups.find((x) => x.id === p.groupId)!;
        return { id: p.id, name: p.name, orgTag: g.orgId, connected: g.connectedToDpm };
      }),
    };
    expect(candidateProjects("kemar", ["intellibus"], world).sort()).toEqual(["forager", "gq", "insights"]);
    expect(await db.select().from(t.groupMembers).where(eq(t.groupMembers.personId, "kemar"))).toHaveLength(5);
  });

  it("leave has no reason column (A5.2)", async () => {
    const [row] = await db.select().from(t.leave);
    expect(Object.keys(row)).not.toContain("reason");
  });
});

// The domain's Kemar fixture and this seed describe the same world; this keeps them from drifting apart.
describe("the domain fixture agrees with the seed", () => {
  it("projects, Kemar's role, and every record's owner and values", async () => {
    for (const project of KEMAR_CONTEXT.projects) {
      const [m] = await db
        .select()
        .from(t.projectMemberships)
        .where(and(eq(t.projectMemberships.projectId, project.id), eq(t.projectMemberships.personId, "kemar")));
      expect(m?.role, project.id).toBe(project.role);
      for (const r of project.records) {
        if (r.type === "work_item") {
          const [row] = await db.select().from(t.workItems).where(eq(t.workItems.id, r.id));
          expect({ number: row.number, owner: row.ownerId, state: row.state, blocked: row.blockedNote }, r.id).toEqual({
            number: r.number,
            owner: r.ownerId,
            state: r.values.state,
            blocked: r.values.blocked_note,
          });
        } else if (r.type === "milestone") {
          const [row] = await db.select().from(t.milestones).where(eq(t.milestones.id, r.id));
          expect({ owner: row.ownerId, forecast: row.forecastDate, target: row.targetDate, name: row.name }, r.id).toEqual({
            owner: r.ownerId,
            forecast: r.values.forecast,
            target: r.values.target,
            name: r.title,
          });
        } else if (r.type === "handover") {
          const [step] = await db.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, r.id));
          const [handover] = await db.select().from(t.handovers).where(eq(t.handovers.id, step.handoverId));
          expect({ owner: handover.fromPersonId, state: step.state }, r.id).toEqual({ owner: r.ownerId, state: r.values.state });
        }
      }
    }
  });

  it("people tied to each project, and BRAID entries", async () => {
    for (const project of KEMAR_CONTEXT.projects) {
      for (const person of project.people) {
        if (person.role) {
          const [m] = await db
            .select()
            .from(t.projectMemberships)
            .where(and(eq(t.projectMemberships.projectId, project.id), eq(t.projectMemberships.personId, person.personId)));
          expect(m?.role, `${project.id}/${person.personId}`).toBe(person.role);
        } else {
          const [c] = await db
            .select()
            .from(t.projectContacts)
            .where(and(eq(t.projectContacts.projectId, project.id), eq(t.projectContacts.personId, person.personId)));
          expect(c, `${project.id}/${person.personId}`).toBeTruthy();
        }
        const [row] = await db.select().from(t.people).where(eq(t.people.id, person.personId));
        expect(row.name).toBe(person.name);
      }
      for (const e of project.braid) {
        const [row] = await db.select().from(t.braidEntries).where(eq(t.braidEntries.id, e.id));
        expect({ project: row.projectId, kind: row.kind, title: row.title, state: row.state }, e.id).toEqual({
          project: project.id,
          kind: e.kind,
          title: e.title,
          state: e.state,
        });
      }
    }
  });

  it("Kemar's approved leave", async () => {
    const rows = await db.select().from(t.leave).where(eq(t.leave.personId, "kemar"));
    expect(rows.map((l) => ({ id: l.id, start: l.startDate, end: l.endDate }))).toEqual(KEMAR_CONTEXT.leave.approved);
  });
});
