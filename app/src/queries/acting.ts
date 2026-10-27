// Where a line's record stands for a person now (conversational plan, phase B). One read serves both
// ends of M20: an answer offers an act on a line only when the asker holds its right now, and a command
// is checked against the same read when it runs (rule 4: never the answer's picture). The rights are the
// screens' own: deciding a proposal (rights.ts), resolving (S13), a work item's owner or a PM or Lead (S2,
// S5), and a project's owner or a PM or Lead for its status (M9). A project the person cannot read now
// holds no right on it (P10).
import { and, desc, eq } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { membersOf, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import type { BraidEntryState } from "../domain/machines/braid-entry";
import type { CommandAbout, CommandAct, CommandProposal, CommandSubject, LineAction, Standing } from "../domain/machines/chat-command";
import { mayDecide, mayResolve, type ProjectRole } from "../domain/rights";
import { clockTime, daysAgo, firstName, KIND_LABEL, projectReader, shortDate, todayIn } from "./project";

type Who = { readable: boolean; role: ProjectRole | null };

async function whoIs(conn: Conn, personId: string, projectId: string): Promise<Who> {
  const reader = await projectReader(conn, personId);
  if (!reader.mayRead(projectId)) return { readable: false, role: null };
  return { readable: true, role: (await membersOf(conn, projectId)).find((m) => m.id === personId)?.role ?? null };
}

const LEADS: readonly ProjectRole[] = ["pm", "lead"];

// S13: the owner of the blocked work is the blocker's owner, or whoever owns a work item it blocks
async function ownsBlockedWork(conn: Conn, entry: { id: string; projectId: string; ownerId: string | null }, personId: string): Promise<boolean> {
  if (entry.ownerId === personId) return true;
  const work = await conn
    .select({ blockedLinks: t.workItems.blockedLinks })
    .from(t.workItems)
    .where(and(eq(t.workItems.projectId, entry.projectId), eq(t.workItems.ownerId, personId)));
  return work.some((w) => w.blockedLinks.includes(entry.id));
}

/** Rule 4, AC1 to AC3: whether the person holds the act's right now, and the record's version now. */
export async function standingOf(conn: Conn, personId: string, cmd: { act: CommandAct; subject: CommandSubject; proposal: CommandProposal | null }): Promise<Standing> {
  const { subject } = cmd;
  const who = await whoIs(conn, personId, subject.projectId);
  const member = who.readable && who.role !== null;
  switch (subject.type) {
    case "braid_entry": {
      const [e] = await conn.select().from(t.braidEntries).where(eq(t.braidEntries.id, subject.id));
      if (!e) return { right: member, version: null };
      if (!member) return { right: false, version: e.version };
      // Deciding a proposal is the decider's right; ending it, or saying "it's cleared" is right, is the resolver's
      const decides = (cmd.act === "approve" || cmd.act === "decline") && cmd.proposal === "entry";
      const isOwner = e.kind === "blocker" ? await ownsBlockedWork(conn, e, personId) : e.ownerId === personId;
      const right = decides ? mayDecide(who.role!, e.kind) : mayResolve({ role: who.role!, isOwner }, e.kind);
      return { right, version: e.version };
    }
    case "work_item": {
      const [w] = await conn.select().from(t.workItems).where(eq(t.workItems.id, subject.id));
      if (!w) return { right: member, version: null };
      return { right: member && (w.ownerId === personId || LEADS.includes(who.role!)), version: w.version };
    }
    case "project": {
      const [p] = await conn.select().from(t.projects).where(eq(t.projects.id, subject.id));
      if (!p) return { right: member, version: null };
      return { right: who.readable && (p.ownerId === personId || (who.role !== null && LEADS.includes(who.role))), version: p.version };
    }
  }
}

/** Live on the log and still open: a blocker or issue that can be resolved. */
const OPEN_REPORTED: readonly BraidEntryState[] = ["reported"];

/**
 * What a line offers its asker now, among the acts its card is for (`offer`), each with the record's
 * version. Approve and decline answer the proposal the entry holds: the entry itself, a member's
 * proposed outcome (U3, the one said first, as the inbox's first button) or "it's cleared" (S13). Mark
 * done and Unblock are only on the asker's own work.
 */
export async function lineActions(conn: Conn, viewerId: string, subject: CommandSubject, offer: readonly CommandAct[]): Promise<LineAction[]> {
  if (!offer.length) return [];
  const out: LineAction[] = [];
  const add = async (act: CommandAct, version: number, proposal?: CommandProposal, extra: Partial<LineAction> = {}) => {
    if (!offer.includes(act)) return;
    const standing = await standingOf(conn, viewerId, { act, subject, proposal: proposal ?? null });
    if (standing.right) out.push({ act, version, ...(proposal ? { proposal } : {}), ...extra });
  };
  switch (subject.type) {
    case "braid_entry": {
      const [e] = await conn.select().from(t.braidEntries).where(eq(t.braidEntries.id, subject.id));
      if (!e) return [];
      const proposal: CommandProposal | null =
        e.state === "proposed" ? "entry" : e.outcomesProposed.length ? "outcome" : e.state === "reported" && e.resolveProposedBy ? "clear" : null;
      if (proposal) {
        const outcome = proposal === "outcome" ? { outcome: e.outcomesProposed[0].outcome } : {};
        await add("approve", e.version, proposal, outcome);
        await add("decline", e.version, proposal);
      } else if ((e.kind === "blocker" || e.kind === "issue") && OPEN_REPORTED.includes(e.state)) await add("resolve", e.version);
      return out;
    }
    case "work_item": {
      const [w] = await conn.select().from(t.workItems).where(eq(t.workItems.id, subject.id));
      if (!w || w.ownerId !== viewerId) return [];
      if (w.state !== "done" && w.state !== "cancelled") await add("mark_done", w.version);
      if (w.state === "blocked") await add("unblock", w.version);
      return out;
    }
    case "project": {
      const [p] = await conn.select().from(t.projects).where(eq(t.projects.id, subject.id));
      if (p && setStatusRecordOf(p).override === "reason_required") await add("give_reason", p.version);
      return out;
    }
  }
}

/** What a command's card names: the record as the asker can read it now, or null when it is gone. */
export async function aboutOf(conn: Conn, subject: CommandSubject): Promise<CommandAbout | null> {
  const [p] = await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, subject.projectId));
  if (!p) return null;
  switch (subject.type) {
    case "braid_entry": {
      const [e] = await conn.select({ kind: t.braidEntries.kind, title: t.braidEntries.title }).from(t.braidEntries).where(eq(t.braidEntries.id, subject.id));
      return e ? { kind: KIND_LABEL[e.kind].toLowerCase(), name: e.title, project: p.name } : null;
    }
    case "work_item": {
      const [w] = await conn.select({ number: t.workItems.number, title: t.workItems.title }).from(t.workItems).where(eq(t.workItems.id, subject.id));
      return w ? { kind: null, name: `${w.number ? `${w.number} ` : ""}${w.title}`, project: p.name } : null;
    }
    case "project":
      return { kind: null, name: p.name, project: p.name };
  }
}

// What the newest change to a record was, in words: "approved", "kept this open"
const DID: Record<string, string> = {
  APPROVE: "approved this",
  DECLINE: "declined this",
  REQUEST_INFO: "asked for more on this",
  WITHDRAW: "withdrew this",
  RESOLVE: "resolved this",
  KEEP_OPEN: "kept this open",
  PROPOSE_OUTCOME: "said how this ended",
  PROPOSE_RESOLVE: "said this is cleared",
  SWITCH: "changed this one's kind",
  MERGE: "merged this",
  GIVE_REASON: "gave a reason",
  OWNER_SETS: "set the status",
  FINISH: "marked this done",
  UNBLOCK: "unblocked this",
};

/**
 * AC2, AC3: what changed since the answer, as the record's trail says: "Alicia approved this at 9:52am."
 * Only reached when the asker still holds the right, so they may read the record and who acted on it.
 */
export async function whatChanged(conn: Conn, askerId: string, subject: CommandSubject, now: Date): Promise<string> {
  const rows = await conn
    .select()
    .from(t.auditEntries)
    .where(and(eq(t.auditEntries.subjectType, subject.type), eq(t.auditEntries.subjectId, subject.id)))
    .orderBy(desc(t.auditEntries.id))
    .limit(10);
  const last = rows.find((r) => r.actorType === "person" && r.actorId) ?? rows[0];
  if (!last) return "This changed since your answer.";
  const when = daysAgo(last.at, now) === "today" ? clockTime(last.at) : `${clockTime(last.at)} on ${shortDate(todayIn(last.at))}`;
  if (last.actorType !== "person" || !last.actorId) return `This changed at ${when}, after your answer.`;
  const [p] = await conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, last.actorId));
  const who = last.actorId === askerId ? "You" : firstName(p?.name ?? "Someone");
  const outcome = last.action === "RESOLVE" && typeof last.detail?.outcome === "string" ? `marked this ${last.detail.outcome}` : null;
  return `${who} ${outcome ?? DID[last.action] ?? "changed this"} at ${when}.`;
}
