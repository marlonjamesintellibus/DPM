import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PROJECT_ROLES } from "../rights";
import {
  actorIn,
  applyMembership,
  candidateProjects,
  isCandidate,
  MEMBERSHIP_STATES,
  type MembershipEvent,
  type MembershipRecord,
  type MembershipState,
  type ProjectRef,
  type World,
} from "./membership";

const kemarIn = (projectId: string, state: MembershipState = "member", role: MembershipRecord["role"] = "member"): MembershipRecord => ({
  projectId,
  personId: "kemar",
  state,
  role,
});

// Kemar's 5 groups (use case 1). The Data guild and the study group have no project to file into;
// the study group is modelled as a project whose owner never connected it, the guild as no project at all.
const PROJECTS: ProjectRef[] = [
  { id: "forager", name: "Forager 2.0", orgTag: "intellibus", connected: true },
  { id: "insights", name: "Store Insights", orgTag: "intellibus", connected: true },
  { id: "gq", name: "GQ & Academy", orgTag: "intellibus", connected: true },
  { id: "study", name: "UWI Mona study group", orgTag: "intellibus", connected: false },
  { id: "partner", name: "Partner project", orgTag: "partner-co", connected: true },
];
const WORLD: World = {
  projects: PROJECTS,
  memberships: [kemarIn("forager"), kemarIn("insights"), kemarIn("gq"), kemarIn("study", "member", "pm"), kemarIn("partner")],
};

const ADMIN = { byAdmin: true };

describe("membership arrows", () => {
  it("invited -> member, requested -> member, member -> left", () => {
    expect(applyMembership(kemarIn("forager", "invited"), { type: "ACCEPT" }, "kemar").record.state).toBe("member");
    expect(applyMembership(kemarIn("forager", "requested"), { type: "APPROVE" }, "alicia", ADMIN).record.state).toBe("member");
    expect(applyMembership(kemarIn("forager"), { type: "LEAVE" }, "kemar").record.state).toBe("left");
  });

  it("a role change keeps the member state and is audited", () => {
    const r = applyMembership(kemarIn("forager"), { type: "CHANGE_ROLE", role: "lead" }, "alicia", ADMIN);
    expect(r.outcome).toMatchObject({ ok: true, from: "member", to: "member" });
    expect(r.record.role).toBe("lead");
    expect(r.audit).toEqual({
      action: "membership.CHANGE_ROLE",
      projectId: "forager",
      personId: "kemar",
      by: "alicia",
      before: { state: "member", role: "member" },
      after: { state: "member", role: "lead" },
    });
  });

  it("refuses the same role again, and roles change only while a member", () => {
    expect(applyMembership(kemarIn("forager"), { type: "CHANGE_ROLE", role: "member" }, "alicia").outcome.ok).toBe(false);
    for (const s of ["invited", "requested", "left"] as const) {
      const record = kemarIn("forager", s);
      const r = applyMembership(record, { type: "CHANGE_ROLE", role: "lead" }, "alicia", ADMIN);
      expect(r).toMatchObject({ outcome: { ok: false }, audit: null });
      expect(r.record).toBe(record);
    }
  });

  it("D4 only the group's admin approves joins and changes roles; only the person answers an invitation", () => {
    expect(applyMembership(kemarIn("forager", "requested"), { type: "APPROVE" }, "jodian").outcome).toMatchObject({ ok: false, reason: "only the group's admin does this" });
    expect(applyMembership(kemarIn("forager"), { type: "CHANGE_ROLE", role: "lead" }, "jodian").outcome.ok).toBe(false);
    expect(applyMembership(kemarIn("forager", "invited"), { type: "ACCEPT" }, "alicia", ADMIN).outcome.ok).toBe(false);
  });

  it("D4 invitations can be declined or expire, requests declined, and anyone can be invited back", () => {
    expect(applyMembership(kemarIn("forager", "invited"), { type: "DECLINE" }, "kemar").record.state).toBe("declined");
    expect(applyMembership(kemarIn("forager", "requested"), { type: "DECLINE" }, "alicia", ADMIN).record.state).toBe("declined");
    expect(applyMembership(kemarIn("forager", "invited"), { type: "EXPIRE" }, "rule", { daysInvited: 13 }).outcome.ok).toBe(false);
    expect(applyMembership(kemarIn("forager", "invited"), { type: "EXPIRE" }, "rule", { daysInvited: 14 }).record.state).toBe("expired");
    for (const s of ["left", "declined", "expired"] as const) expect(applyMembership(kemarIn("forager", s), { type: "INVITE" }, "alicia", ADMIN).record.state).toBe("invited");
  });

  it("D4 the admin cannot leave until someone else is admin", () => {
    expect(applyMembership(kemarIn("forager"), { type: "LEAVE" }, "kemar", { personIsAdmin: true }).outcome).toMatchObject({ ok: false, reason: "make someone else the group's admin first" });
  });

  it("refuses arrows that are not drawn; left returns only by invitation", () => {
    expect(applyMembership(kemarIn("forager", "invited"), { type: "APPROVE" }, "alicia").outcome.ok).toBe(false);
    expect(applyMembership(kemarIn("forager", "requested"), { type: "ACCEPT" }, "kemar").outcome.ok).toBe(false);
    expect(applyMembership(kemarIn("forager"), { type: "ACCEPT" }, "kemar").outcome.ok).toBe(false);
    for (const type of ["ACCEPT", "APPROVE", "LEAVE"] as const) {
      expect(applyMembership(kemarIn("forager", "left"), { type }, "kemar").outcome.ok).toBe(false);
    }
  });

  it("an actor's role is read from current membership (rule 7)", () => {
    expect(actorIn("kemar", "study", WORLD.memberships)).toEqual({ personId: "kemar", role: "pm" });
    const left = WORLD.memberships.map((x) => (x.projectId === "study" ? applyMembership(x, { type: "LEAVE" }, "kemar").record : x));
    expect(actorIn("kemar", "study", left)).toEqual({ personId: "kemar", role: null });
    expect(actorIn("kemar", "sante", WORLD.memberships).role).toBeNull();
  });
});

describe("candidate projects", () => {
  it("Kemar's 5 groups give 3 candidates in his own org", () => {
    expect(candidateProjects("kemar", ["intellibus"], WORLD)).toEqual(["forager", "insights", "gq"]);
  });

  it("E75 a group whose owner has not connected it to DPM is not a candidate", () => {
    expect(isCandidate("kemar", ["intellibus"], "study", WORLD)).toBe(false);
  });

  it("E76 groups tagged to two orgs: each org's candidates are its own", () => {
    expect(candidateProjects("kemar", ["partner-co"], WORLD)).toEqual(["partner"]);
    expect(candidateProjects("kemar", ["intellibus", "partner-co"], WORLD)).toEqual(["forager", "insights", "gq", "partner"]);
  });

  it("E77 leaving a project removes it from the candidates", () => {
    const memberships = WORLD.memberships.map((x) => (x.projectId === "forager" ? applyMembership(x, { type: "LEAVE" }, "kemar").record : x));
    expect(candidateProjects("kemar", ["intellibus"], { ...WORLD, memberships })).toEqual(["insights", "gq"]);
  });

  it("E78 a project the person is not a member of is never a candidate", () => {
    const world = { ...WORLD, projects: [...PROJECTS, { id: "sante", name: "Sante Group", orgTag: "intellibus", connected: true }] };
    expect(isCandidate("kemar", ["intellibus"], "sante", world)).toBe(false);
  });

  it("E81 a group with no project (Data guild) is never a candidate", () => {
    expect(isCandidate("kemar", ["intellibus"], "data-guild", WORLD)).toBe(false);
  });
});

describe("memberships keep their rules", () => {
  const event = fc.oneof(
    fc.constantFrom<MembershipEvent>({ type: "ACCEPT" }, { type: "APPROVE" }, { type: "LEAVE" }),
    fc.constantFrom(...PROJECT_ROLES).map((role): MembershipEvent => ({ type: "CHANGE_ROLE", role })),
  );

  it("every move is audited; roles change only while a member; left is final; candidates need member, connected and org", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MEMBERSHIP_STATES),
        fc.array(event, { maxLength: 20 }),
        fc.boolean(),
        fc.constantFrom("intellibus", "partner-co"),
        (start, events, connected, org) => {
          let record = kemarIn("forager", start);
          for (const e of events) {
            const r = applyMembership(record, e, "alicia");
            expect(r.audit !== null).toBe(r.outcome.ok);
            if (!r.outcome.ok) expect(r.record).toBe(record);
            if (r.record.role !== record.role) expect([record.state, r.record.state]).toEqual(["member", "member"]);
            if (record.state === "left") expect(r.outcome.ok).toBe(false);
            record = r.record;
            const world: World = { memberships: [record], projects: [{ ...PROJECTS[0], connected }] };
            expect(isCandidate("kemar", [org], "forager", world)).toBe(record.state === "member" && connected && org === "intellibus");
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
