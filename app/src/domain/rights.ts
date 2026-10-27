// Who may report, decide and resolve each kind of BRAID entry (use case 1, "Who can report
// and who decides"; decisions S10 to S13, 26 Oct). The table is data, so an org can change it
// later without touching the rules that read it.

export const PROJECT_ROLES = ["pm", "lead", "member"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const BRAID_KINDS = ["blocker", "risk", "assumption", "issue", "dependency", "decision"] as const;
export type BraidKind = (typeof BRAID_KINDS)[number];

type Rights = {
  report: readonly ProjectRole[];
  /** Roles that approve it onto the log; null when it goes on the log as reported. */
  decide: readonly ProjectRole[] | null;
  /** Roles that may resolve it, and whether the entry's owner may too. */
  resolve: { roles: readonly ProjectRole[]; owner: boolean };
};

const LEADS = ["pm", "lead"] as const;
const ANYONE = PROJECT_ROLES;

export const BRAID_RIGHTS: Record<BraidKind, Rights> = {
  // Briefing: anyone reports, Atlas merges repeats. S13: the owner of the blocked work, or a PM or Lead, resolves.
  blocker: { report: ANYONE, decide: null, resolve: { roles: LEADS, owner: true } },
  // Briefing: anyone reports; S13: PM, Lead or the entry's owner resolves
  issue: { report: ANYONE, decide: null, resolve: { roles: LEADS, owner: true } },
  // Briefing: only the PM or Lead puts a risk on the log
  risk: { report: ANYONE, decide: LEADS, resolve: { roles: LEADS, owner: false } },
  // S10: same leads as risks
  assumption: { report: ANYONE, decide: LEADS, resolve: { roles: LEADS, owner: false } },
  dependency: { report: ANYONE, decide: LEADS, resolve: { roles: LEADS, owner: false } },
  // Briefing: pending until explicitly approved; S11: one approver with the right
  decision: { report: ANYONE, decide: LEADS, resolve: { roles: LEADS, owner: false } },
};

export function mayReport(role: ProjectRole, kind: BraidKind): boolean {
  return BRAID_RIGHTS[kind].report.includes(role);
}

export function needsApproval(kind: BraidKind): boolean {
  return BRAID_RIGHTS[kind].decide !== null;
}

export function mayDecide(role: ProjectRole, kind: BraidKind): boolean {
  return BRAID_RIGHTS[kind].decide?.includes(role) ?? false;
}

/** "isOwner" means the owner of the blocked work for a blocker, and the entry's owner for an issue. */
export function mayResolve(who: { role: ProjectRole; isOwner: boolean }, kind: BraidKind): boolean {
  const r = BRAID_RIGHTS[kind].resolve;
  return r.roles.includes(who.role) || (r.owner && who.isOwner);
}

/** Merging and unmerging duplicate entries (M16): the PM only. */
export const MERGE_ROLES: readonly ProjectRole[] = ["pm"];

export function mayMerge(role: ProjectRole): boolean {
  return MERGE_ROLES.includes(role);
}

/**
 * Where a newly reported entry lands. Report-only kinds go on the log as reported. Risks,
 * assumptions and dependencies reported by someone who can approve them go straight on (E92).
 * Decisions always start as proposals, even from a PM: approving is a separate, explicit act (S12).
 */
export function landsAs(kind: BraidKind, reporterRole: ProjectRole): "reported" | "on_log" | "proposed" {
  if (!needsApproval(kind)) return "reported";
  if (kind !== "decision" && mayDecide(reporterRole, kind)) return "on_log";
  return "proposed";
}
