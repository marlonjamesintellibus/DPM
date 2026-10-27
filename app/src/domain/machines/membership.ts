// M13. Project membership (Membership), plus who a project is a routing candidate for.
// Membership comes from the Atlas group behind the project (meeting D2) and is seeded in this
// slice. A role change keeps the state at member, so each one is returned as an audit entry:
// the state alone would not show that the role moved.
import { defineMachine, transition, type Outcome } from "../machine";
import { PROJECT_ROLES, type ProjectRole } from "../rights";

// D4: invited -> declined | expired, requested -> declined, left | declined | expired -> invited (to rejoin)
export const MEMBERSHIP_STATES = ["invited", "requested", "member", "left", "declined", "expired"] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

export type MembershipRecord = {
  projectId: string;
  personId: string;
  state: MembershipState;
  role: ProjectRole;
};

export type MembershipEvent =
  | { type: "ACCEPT" } // the person accepts an invitation
  | { type: "APPROVE" } // a request to join is approved
  | { type: "DECLINE" } // the person declines an invitation, or the admin a request
  | { type: "EXPIRE" } // timer: an invitation nobody answered
  | { type: "INVITE" } // the admin invites someone back
  | { type: "LEAVE" }
  | { type: "CHANGE_ROLE"; role: ProjectRole };

/** An invitation nobody answers expires after this many days (D4). */
export const INVITE_EXPIRY_DAYS = 14;

/**
 * D4: who is acting. The group's admin (its creator) approves joins and role changes; only the
 * person answers their own invitation. `daysInvited` is for the expiry timer.
 */
export type MembershipCtx = { byAdmin?: boolean; byPerson?: boolean; personIsAdmin?: boolean; daysInvited?: number };

export type MembershipAudit = {
  action: `membership.${MembershipEvent["type"]}`;
  projectId: string;
  personId: string;
  by: string;
  before: { state: MembershipState; role: ProjectRole };
  after: { state: MembershipState; role: ProjectRole };
};

type Ctx = MembershipCtx & { record: MembershipRecord };

const admin = ({ byAdmin }: Ctx) => (byAdmin ? null : "only the group's admin does this");
const person = ({ byPerson }: Ctx) => (byPerson ? null : "only the person answers their own invitation");

export const membershipMachine = defineMachine<MembershipState, MembershipEvent, Ctx>({
  name: "membership",
  states: MEMBERSHIP_STATES,
  arrows: [
    { from: ["invited"], on: "ACCEPT", to: "member", guard: person },
    { from: ["requested"], on: "APPROVE", to: "member", guard: admin },
    { from: ["invited"], on: "DECLINE", to: "declined", guard: person },
    { from: ["requested"], on: "DECLINE", to: "declined", guard: admin },
    {
      from: ["invited"],
      on: "EXPIRE",
      to: "expired",
      guard: ({ daysInvited }) => (daysInvited === undefined ? "the days since the invitation are needed" : daysInvited >= INVITE_EXPIRY_DAYS ? null : `invited ${daysInvited} of ${INVITE_EXPIRY_DAYS} days ago`),
    },
    { from: ["left", "declined", "expired"], on: "INVITE", to: "invited", guard: admin },
    // The admin leaving would leave nobody to approve joins: another admin comes first
    { from: ["member"], on: "LEAVE", to: "left", guard: (c) => (c.personIsAdmin ? "make someone else the group's admin first" : c.byPerson || c.byAdmin ? null : "only the person or the admin") },
    {
      from: ["member"],
      on: "CHANGE_ROLE",
      to: "member",
      guard: (c, { role }) => {
        if (!PROJECT_ROLES.includes(role)) return `${role} is not a project role`;
        if (role === c.record.role) return `already ${role}`;
        return admin(c);
      },
    },
  ],
});

export type MembershipResult = {
  outcome: Outcome<MembershipState>;
  record: MembershipRecord;
  /** Written with every move; null when the event was refused. */
  audit: MembershipAudit | null;
};

/** Applies an event to one membership. A refused event returns the record unchanged and no audit entry. */
export function applyMembership(record: MembershipRecord, event: MembershipEvent, by: string, ctx: MembershipCtx = {}): MembershipResult {
  // Leaving or answering one's own invitation needs no flag: the person acting is the member
  const outcome = transition(membershipMachine, record.state, event, { byPerson: by === record.personId, ...ctx, record });
  if (!outcome.ok) return { outcome, record, audit: null };
  const next: MembershipRecord = {
    ...record,
    state: outcome.to,
    role: event.type === "CHANGE_ROLE" ? event.role : record.role,
  };
  const audit: MembershipAudit = {
    action: `membership.${event.type}`,
    projectId: record.projectId,
    personId: record.personId,
    by,
    before: { state: record.state, role: record.role },
    after: { state: next.state, role: next.role },
  };
  return { outcome, record: next, audit };
}

/** Who is acting on a project, with the role read when the action runs (rule 7), not when a button was shown. */
export type Actor = { personId: string; role: ProjectRole | null };

export function actorIn(personId: string, projectId: string, memberships: readonly MembershipRecord[]): Actor {
  const m = memberships.find((x) => x.personId === personId && x.projectId === projectId && x.state === "member");
  return { personId, role: m?.role ?? null };
}

/**
 * A project as routing sees it. `connected` means the group owner has connected the group to DPM.
 * A group with no project (the Data guild, E81) has no ProjectRef, so it is never a target.
 */
/** adminId: the person who created the project's group, its admin from the start (D4). */
export type ProjectRef = { id: string; name: string; orgTag: string; connected: boolean; adminId?: string };

export type World = { memberships: readonly MembershipRecord[]; projects: readonly ProjectRef[] };

/** Invited, requested and left do not count: only a current member. */
export function isMember(personId: string, projectId: string, memberships: readonly MembershipRecord[]): boolean {
  return memberships.some((m) => m.personId === personId && m.projectId === projectId && m.state === "member");
}

/**
 * Server check 9. A project is a candidate for a person only when they are a member, the group owner
 * has connected it to DPM, and its org tag is one of `orgTags`. For a dashboard that is the reader's
 * org; for routing an author's capture it is every org their Atlas account is linked to (E76).
 */
export function isCandidate(personId: string, orgTags: readonly string[], projectId: string, world: World): boolean {
  const project = world.projects.find((p) => p.id === projectId);
  return (
    project !== undefined &&
    project.connected &&
    orgTags.includes(project.orgTag) &&
    isMember(personId, projectId, world.memberships)
  );
}

export function candidateProjects(personId: string, orgTags: readonly string[], world: World): string[] {
  return world.projects.filter((p) => isCandidate(personId, orgTags, p.id, world)).map((p) => p.id);
}
