// A person's Today inbox (A8.2, M10, L6b, L6c). Inbox rows store only a cause key; every title,
// "why here" and action is worked out here from the cause and the data as it is now, so a title
// never goes stale when the plan moves ("but the plan says At risk"). Only the viewer's own live
// items are read, and only for projects they may still read.
import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { loadBraidLog, loadCapture, loadItems, setStatusRecordOf } from "../db/records";
import { saveBlockers } from "../domain/machines/capture";
import * as t from "../db/schema";
import { switchedTo, type BraidEntryRecord } from "../domain/machines/braid-entry";
import { liveEntryOf } from "../domain/machines/kind-switch";
import { withArticle } from "../domain/shared";
import type { InboxItemState } from "../domain/machines/inbox-item";
import type { BraidKind } from "../domain/rights";
import { calculatePlan } from "../domain/status/rules";
import { getLeaveImpact } from "./leave";
import { describeOwnerAsk } from "./owner-ask";
import { signalsFor } from "./signals";
import { OUTCOME_SAID } from "./review";
import { clockTime, daysAgo, firstName, KIND_LABEL, peopleById, projectReader, shortDate, STATUS_LABEL, statusLabel, todayIn } from "./project";

export type InboxCause =
  | "status_set_with_no_reason"
  | "keep_set_status"
  | "approve"
  | "no_decider"
  | "more_info"
  | "blocker_new"
  | "clear"
  /** M2 review reminder: the author has not saved an update yet. */
  | "review_waiting"
  /** D6: someone asked for leave; what it touches in the viewer's project. */
  | "leave_impact"
  /** E93: the work a blocker held has moved on; is the blocker resolved? */
  | "confirm_clear"
  /** D10: Atlas drafted what follows a realised risk, a broken assumption or a late dependency. */
  | "follow_up"
  /** M5, A10.1 (D18): work went Done with no PR or document linked. */
  | "done_no_change"
  /** M17: a member asked to change an entry's kind; a PM or Lead switches or keeps it. */
  | "kind_change"
  /** D32: work still Blocked whose blocker changed kind; its owner unblocks it or links another blocker. */
  | "blocked_without_blocker"
  /** Section 20, U2: a dependency's promised date has passed; a PM or Lead marks it met or late, or gives a new date. */
  | "dependency_due"
  /** Section 20, U3: a member said a risk, assumption or dependency ended; a PM or Lead decides, or keeps it open. */
  | "confirm_outcome"
  /** Section 20, U5 and U7 (M37): someone's update changes the viewer's record, or proposes new work to a PM or Lead. */
  | "owner_ask"
  /** Phase L, M31: a correction to the project's vocabulary waits for a PM or Lead. */
  | "vocab_change"
  /** Phase K, M29: trouble Atlas noticed that nobody reported, one item per project per day (SG10). */
  | "signals";

export type InboxGroup = "do_now" | "today" | "this_week";
export const GROUP_LABEL: Record<InboxGroup, string> = { do_now: "Do now", today: "Today", this_week: "This week" };
const GROUP_ORDER: readonly InboxGroup[] = ["do_now", "today", "this_week"];

export type InboxSubject =
  | { type: "project"; id: string }
  | { type: "braid_entry"; id: string; projectId: string }
  | { type: "capture"; id: string }
  | { type: "leave"; id: string; projectId: string }
  | { type: "work_item"; id: string; projectId: string }
  | { type: "kind_request"; id: string; entryId: string; projectId: string }
  | { type: "owner_ask"; id: string; projectId: string }
  | { type: "vocabulary_change"; id: string; projectId: string }
  /** id is "<project>@<day>": the signals that reached the viewer on that project that day. */
  | { type: "signals"; id: string; projectId: string; day: string };

export type InboxEntry = {
  id: string;
  causeKey: string;
  cause: InboxCause;
  state: InboxItemState;
  title: string;
  why: string;
  /** "Delivery check", "Kemar's update" */
  source: string;
  /** "8m", "2h" for rules; "9:10am" for someone's words; "yesterday" or "3 days ago" before today */
  age: string;
  /** "Delivery check · 8m", "Kemar's update · 9:10am" */
  sourceLine: string;
  action: string;
  group: InboxGroup;
  groupLabel: string;
  /** What the screen opens. */
  subject: InboxSubject;
  /** Null for the author's own review reminder, which belongs to no project. */
  project: { id: string; name: string } | null;
  createdAt: Date;
};

export type Inbox = {
  viewerId: string;
  /** Worst first (A4.4): Do now, Today, This week, then oldest first. */
  items: InboxEntry[];
  groups: { group: InboxGroup; label: string; items: InboxEntry[] }[];
};

const STATUS_CAUSES: readonly string[] = ["status_set_with_no_reason", "keep_set_status"];
const WORK_CAUSES: readonly string[] = ["done_no_change", "blocked_without_blocker"];
const NOT_BRAID: readonly string[] = [...STATUS_CAUSES, ...WORK_CAUSES, "review_waiting", "leave_impact", "kind_change", "owner_ask", "vocab_change", "signals"];

// Rule-made items say how long they have waited; items from someone's words say when they came
function ageOf(createdAt: Date, now: Date, fromWords: boolean): string {
  const when = daysAgo(createdAt, now);
  if (when !== "today") return when;
  if (fromWords) return clockTime(createdAt);
  const minutes = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60_000));
  if (minutes < 1) return "now";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

const RAISED: Record<BraidKind, string> = {
  blocker: "reported a blocker",
  issue: "reported an issue",
  risk: "raised a risk",
  assumption: "raised an assumption",
  dependency: "raised a dependency",
  decision: "proposed a decision",
};

function waitWhy(kind: BraidKind): string {
  const plural = { blocker: "blockers", issue: "issues", risk: "risks", assumption: "assumptions", dependency: "dependencies", decision: "decisions" }[kind];
  return kind === "decision" ? "decisions stay pending until a PM or Lead approves" : `${plural} go on the log only when a PM or Lead approves`;
}

// A decision reads as what to do ("move the daily refresh to 6am"); other titles keep their case
function asClause(entry: BraidEntryRecord): string {
  return entry.kind === "decision" ? entry.title.charAt(0).toLowerCase() + entry.title.slice(1) : entry.title;
}

export async function getInbox(conn: Conn, viewerId: string, now: Date): Promise<Inbox> {
  const rows = (await conn
    .select()
    .from(t.inboxItems)
    .where(and(eq(t.inboxItems.ownerId, viewerId), inArray(t.inboxItems.state, ["open", "snoozed"]))))
    // A snoozed item comes back once its time has passed, even before the timer moves it
    .filter((r) => r.state === "open" || (r.snoozedUntil !== null && r.snoozedUntil <= now));
  if (!rows.length) return { viewerId, items: [], groups: [] };

  const reader = await projectReader(conn, viewerId);
  const parsed = rows.map((r) => {
    const at = r.causeKey.indexOf(":");
    return { row: r, cause: r.causeKey.slice(0, at) as InboxCause, subjectId: r.causeKey.slice(at + 1) };
  });

  // Each project's data is read once, as it is now
  const entryIds = parsed.filter((p) => !NOT_BRAID.includes(p.cause)).map((p) => p.subjectId);
  const entryProjects = entryIds.length
    ? await conn.select({ id: t.braidEntries.id, projectId: t.braidEntries.projectId }).from(t.braidEntries).where(inArray(t.braidEntries.id, entryIds))
    : [];
  const workIds = parsed.filter((p) => WORK_CAUSES.includes(p.cause)).map((p) => p.subjectId);
  const doneWork = workIds.length ? await conn.select().from(t.workItems).where(inArray(t.workItems.id, workIds)) : [];
  const requestIds = parsed.filter((p) => p.cause === "kind_change").map((p) => p.subjectId);
  const requests = requestIds.length ? await conn.select().from(t.braidKindRequests).where(inArray(t.braidKindRequests.id, requestIds)) : [];
  const changeIds = parsed.filter((p) => p.cause === "vocab_change").map((p) => p.subjectId);
  const changes = changeIds.length ? await conn.select().from(t.vocabularyChanges).where(inArray(t.vocabularyChanges.id, changeIds)) : [];
  const projectOf = (p: (typeof parsed)[number]) =>
    STATUS_CAUSES.includes(p.cause)
      ? p.subjectId
      : WORK_CAUSES.includes(p.cause)
        ? doneWork.find((w) => w.id === p.subjectId)?.projectId
        : p.cause === "kind_change"
          ? requests.find((r) => r.id === p.subjectId)?.projectId
          : p.cause === "vocab_change"
            ? changes.find((c) => c.id === p.subjectId)?.projectId
            : entryProjects.find((e) => e.id === p.subjectId)?.projectId;
  const projectIds = [...new Set(parsed.map(projectOf).filter((id): id is string => !!id && reader.mayRead(id)))];
  const today = todayIn(now);
  const projects = new Map<string, { row: typeof t.projects.$inferSelect; calculated: ReturnType<typeof calculatePlan>["project"]; log: Record<string, BraidEntryRecord> }>();
  for (const id of projectIds) {
    const [[row], threads, milestones, workItems, { log }] = await Promise.all([
      conn.select().from(t.projects).where(eq(t.projects.id, id)),
      conn.select().from(t.threads).where(eq(t.threads.projectId, id)),
      conn.select().from(t.milestones).where(eq(t.milestones.projectId, id)),
      conn.select().from(t.workItems).where(eq(t.workItems.projectId, id)),
      loadBraidLog(conn, id),
    ]);
    projects.set(id, { row, calculated: calculatePlan({ threads, milestones, workItems }, today).project, log: { ...log } });
  }

  const people = await peopleById(
    conn,
    [
      ...[...projects.values()].flatMap((p) => Object.values(p.log).flatMap((e) => [e.reportedBy, e.resolveProposedBy, ...e.answers.map((a) => a.by), ...e.outcomesProposed.map((o) => o.by)])),
      ...requests.map((r) => r.askedBy),
      ...changes.flatMap((c) => [c.forId, c.personId]),
    ],
  );
  const nameOf = (id: string | null) => (id ? firstName(people.get(id)?.name ?? id) : "Someone");

  const items: InboxEntry[] = [];

  // The author's own unsaved updates (M2 reminder). Only the author owns these, and the capture is theirs
  for (const p of parsed.filter((x) => x.cause === "review_waiting")) {
    const capture = await loadCapture(conn, p.subjectId);
    if (!capture || capture.row.authorId !== viewerId) continue;
    const { needsOk } = saveBlockers((await loadItems(conn, p.subjectId)).items);
    const age = ageOf(capture.row.messageAt, now, true);
    items.push({
      id: p.row.id,
      causeKey: p.row.causeKey,
      cause: p.cause,
      state: p.row.state,
      title: needsOk ? `${needsOk} ${needsOk === 1 ? "update" : "updates"} waiting for your OK` : "Your update is ready to save",
      why: "you have not saved this update yet; it expires after 7 days",
      source: "Your update",
      age,
      sourceLine: `Your update · ${age}`,
      action: "Review",
      group: "today",
      groupLabel: GROUP_LABEL.today,
      subject: { type: "capture", id: p.subjectId },
      project: null,
      createdAt: p.row.createdAt,
    });
  }

  // D6: a request or change waiting on an admin; each lead sees only their project's part
  for (const p of parsed.filter((x) => x.cause === "leave_impact")) {
    const [leaveId, projectId] = p.subjectId.split("@");
    const impact = await getLeaveImpact(conn, viewerId, leaveId, projectId);
    if (!impact.found) continue;
    const who = firstName(impact.person.name);
    const things = impact.count === 0 ? "nothing to cover" : `${impact.count} ${impact.count === 1 ? "thing" : "things"} to cover`;
    const age = ageOf(p.row.createdAt, now, true);
    items.push({
      id: p.row.id,
      causeKey: p.row.causeKey,
      cause: p.cause,
      state: p.row.state,
      title: `${who} asked ${impact.change ? "to change leave to" : "for leave"} ${impact.askedLabel}: ${things} in ${impact.project.name}`,
      why: impact.mayDecide ? "you are an admin of one of their projects, so you decide this leave" : "an admin decides the leave; this is what it touches in your project",
      source: `${who}'s update`,
      age,
      sourceLine: `${who}'s update · ${age}`,
      action: impact.mayDecide ? "Decide" : "Plan cover",
      group: "today",
      groupLabel: GROUP_LABEL.today,
      subject: { type: "leave", id: leaveId, projectId },
      project: impact.project,
      createdAt: p.row.createdAt,
    });
  }

  // M37 (section 20, U5 and U7): an update asks the viewer to change their record, or to add new work
  for (const p of parsed.filter((x) => x.cause === "owner_ask")) {
    const ask = await describeOwnerAsk(conn, p.subjectId);
    if (!ask || !reader.mayRead(ask.project.id)) continue;
    const age = ageOf(ask.at, now, true);
    const newWork = ask.record.kind === "new_work";
    items.push({
      id: p.row.id,
      causeKey: p.row.causeKey,
      cause: p.cause,
      state: p.row.state,
      title: newWork ? `${ask.author} proposes new work: ${ask.record.title}` : `${ask.author} says: ${ask.what}, ${ask.change}`,
      why: newWork ? "there is no task for it in the plan; a PM or Lead adds it, or says why not" : "it is yours, so only you change it; accept it, or decline and say why",
      source: `${ask.author}'s update`,
      age,
      sourceLine: `${ask.author}'s update · ${age}`,
      action: "Decide",
      group: "today",
      groupLabel: GROUP_LABEL.today,
      subject: { type: "owner_ask", id: ask.record.id, projectId: ask.project.id },
      project: ask.project,
      createdAt: p.row.createdAt,
    });
  }

  // Phase K, M29: what Atlas noticed on one project that day (SG10). Only signals raised to the viewer now
  // that still hold when read (SG1, SG9) are shown; none left, and the item is not shown either
  for (const p of parsed.filter((x) => x.cause === "signals")) {
    const [projectId, day] = p.subjectId.split("@");
    const shown = await signalsFor(conn, viewerId, projectId, day, now);
    if (!shown.length) continue;
    const [project] = await conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(eq(t.projects.id, projectId));
    const owner = shown.every((s) => s.stage === "owner");
    const age = ageOf(p.row.createdAt, now, false);
    items.push({
      id: p.row.id,
      causeKey: p.row.causeKey,
      cause: p.cause,
      state: p.row.state,
      title: shown.length === 1 ? shown[0].text : `Atlas noticed ${shown.length} things on ${project.name}`,
      why: owner
        ? "it is yours, and nothing in the data has moved it lately; say it is still going, or update it"
        : "nobody reported this; Atlas noticed it in the data. Accept it as a risk, or dismiss it and say why",
      source: "Atlas",
      age,
      sourceLine: `Atlas · ${age}`,
      action: owner ? "Answer" : "Review",
      group: "today",
      groupLabel: GROUP_LABEL.today,
      subject: { type: "signals", id: p.subjectId, projectId, day },
      project,
      createdAt: p.row.createdAt,
    });
  }

  for (const p of parsed.filter((x) => x.cause !== "review_waiting" && x.cause !== "leave_impact" && x.cause !== "owner_ask" && x.cause !== "signals")) {
    const projectId = projectOf(p);
    const project = projectId ? projects.get(projectId) : undefined;
    if (!project) continue; // not readable any more, or the subject is gone
    const base = { id: p.row.id, causeKey: p.row.causeKey, cause: p.cause, state: p.row.state, project: { id: project.row.id, name: project.row.name }, createdAt: p.row.createdAt };
    const make = (fields: { title: string; why: string; source: string; fromWords: boolean; action: string; group: InboxGroup; subject: InboxSubject }) => {
      const age = ageOf(p.row.createdAt, now, fields.fromWords);
      items.push({
        ...base,
        title: fields.title,
        why: fields.why,
        source: fields.source,
        age,
        sourceLine: `${fields.source} · ${age}`,
        action: fields.action,
        group: fields.group,
        groupLabel: GROUP_LABEL[fields.group],
        subject: fields.subject,
      });
    };

    if (STATUS_CAUSES.includes(p.cause)) {
      const record = setStatusRecordOf(project.row);
      const set = record.setStatus ? STATUS_LABEL[record.setStatus] : "a status";
      const plan = statusLabel(project.calculated);
      const subject: InboxSubject = { type: "project", id: project.row.id };
      if (p.cause === "status_set_with_no_reason") {
        make({
          title: `${project.row.name} is set ${set}, but the plan says ${plan}`,
          why: "a status and the data disagree, and no reason is given",
          source: "Delivery check",
          fromWords: false,
          action: "Add reason",
          group: "do_now",
          subject,
        });
      } else {
        make({
          title: `${project.row.name}: plan now says ${plan}. Keep ${set}?`,
          why: `your reason was given when the plan said ${statusLabel(record.reasonGivenAt)}`,
          source: "Delivery check",
          fromWords: false,
          action: "Keep",
          group: "this_week",
          subject,
        });
      }
      continue;
    }

    if (p.cause === "done_no_change") {
      const w = doneWork.find((x) => x.id === p.subjectId)!;
      make({
        title: `${w.number ?? w.title} is Done with no linked change`,
        why: `${w.title} went Done without a PR or document; link the change that finished it`,
        source: "Delivery check",
        fromWords: false,
        action: "Add link",
        group: "today",
        subject: { type: "work_item", id: w.id, projectId: project.row.id },
      });
      continue;
    }

    if (p.cause === "blocked_without_blocker") {
      const w = doneWork.find((x) => x.id === p.subjectId)!;
      const blocker = w.blockedLinks.map((id) => project.log[id]).find((e) => e && switchedTo(e));
      const now_ = blocker ? project.log[liveEntryOf(project.log, blocker.id)] : undefined;
      make({
        title: `${w.number ?? w.title} is still Blocked, but its blocker is now ${now_ ? withArticle(KIND_LABEL[now_.kind].toLowerCase()) : "gone"}`,
        why: `${blocker ? `"${blocker.title}" changed kind, so nothing on the log stops ${w.title} now` : "nothing on the log stops it now"}; unblock it, or link another blocker`,
        source: "Delivery check",
        fromWords: false,
        action: "Unblock",
        group: "today",
        subject: { type: "work_item", id: w.id, projectId: project.row.id },
      });
      continue;
    }

    if (p.cause === "kind_change") {
      const r = requests.find((x) => x.id === p.subjectId)!;
      const asked = project.log[r.entryId];
      if (!asked) continue;
      const asker = nameOf(r.askedBy);
      make({
        title: `${asker} asked to make this ${withArticle(KIND_LABEL[r.toKind].toLowerCase())}: ${asked.title}`,
        why: `"${r.why}" Only a PM or Lead changes an entry's kind`,
        source: `${asker}'s request`,
        fromWords: true,
        action: "Decide",
        group: r.remindersSent > 0 ? "do_now" : "today",
        subject: { type: "kind_request", id: r.id, entryId: r.entryId, projectId: project.row.id },
      });
      continue;
    }

    if (p.cause === "vocab_change") {
      // Phase L, M31: who said it (or whose moves in review, CD14), and what it changes
      const c = changes.find((x) => x.id === p.subjectId)!;
      const who = nameOf(c.forId);
      const person = c.personId ? (people.get(c.personId)?.name ?? "them") : null;
      const what =
        c.kind === "alias"
          ? c.remove
            ? `stop reading "${c.word}" as ${project.row.name}`
            : `read "${c.word}" as ${project.row.name}`
          : c.remove
            ? `take ${person} off ${project.row.name}'s contacts`
            : `add ${person} as a contact on ${project.row.name}`;
      make({
        title: c.proposedBy ? `${who} asked Atlas to ${what}` : `Atlas suggests: ${what.charAt(0).toUpperCase()}${what.slice(1)}`,
        why: c.proposedBy
          ? "a correction changes how Atlas files everyone's updates on this project, so a PM or Lead decides it"
          : `${who} moved updates with "${c.word ?? person}" to ${project.row.name} twice in review; a PM or Lead decides whether Atlas should`,
        source: c.proposedBy ? `${who}'s correction` : "Atlas",
        fromWords: !!c.proposedBy,
        action: "Decide",
        group: c.remindersSent > 0 ? "do_now" : "this_week",
        subject: { type: "vocabulary_change", id: c.id, projectId: project.row.id },
      });
      continue;
    }

    const entry = project.log[p.subjectId];
    if (!entry) continue;
    const subject: InboxSubject = { type: "braid_entry", id: entry.id, projectId: project.row.id };
    const reporter = nameOf(entry.reportedBy);
    const fromCapture = entry.sources.some((s) => s.personId === entry.reportedBy && s.captureId !== null);
    const reporterSource = `${reporter}'s ${fromCapture ? "update" : "report"}`;
    switch (p.cause) {
      case "approve":
        make({
          title: `${reporter} ${RAISED[entry.kind]}: ${asClause(entry)}`,
          why: waitWhy(entry.kind),
          source: reporterSource,
          fromWords: true,
          action: "Review",
          // A proposal that has been reminded about has waited too long (S18)
          group: entry.remindersSent > 0 ? "do_now" : "today",
          subject,
        });
        break;
      case "no_decider":
        make({
          title: `No one can approve this on ${project.row.name}`,
          why: `nobody on the project holds the right to approve a ${KIND_LABEL[entry.kind].toLowerCase()}: ${entry.title}`,
          source: "Delivery check",
          fromWords: false,
          action: "Assign",
          group: "today",
          subject,
        });
        break;
      case "more_info": {
        const asked = [...entry.answers].reverse().find((a) => a.act === "request_info" && a.round === entry.round);
        make({
          title: `${nameOf(asked?.by ?? null)} asked for more on your ${KIND_LABEL[entry.kind].toLowerCase()}`,
          why: `${entry.title} waits for your answer before anyone decides`,
          source: `${nameOf(asked?.by ?? null)}'s question`,
          fromWords: true,
          action: "Reply",
          group: "today",
          subject,
        });
        break;
      }
      case "blocker_new":
        make({
          title: `New blocker on ${project.row.name}: ${entry.title}`,
          why: "a blocker went on the log, and it stops work until it is cleared",
          source: reporterSource,
          fromWords: true,
          action: "Acknowledge",
          group: "do_now",
          subject,
        });
        break;
      case "confirm_clear":
        make({
          title: `Your work is moving again. Is this blocker resolved? ${entry.title}`,
          why: "nothing it was holding is blocked now; only you or a PM or Lead can resolve it",
          source: "Delivery check",
          fromWords: false,
          action: "Resolve",
          group: "today",
          subject,
        });
        break;
      case "follow_up": {
        const from = entry.links.find((l) => l.relation === "raised_from");
        const origin = from ? project.log[from.entryId] : undefined;
        const what = origin ? { realised: "was realised", broken: "broke", late: "is late" }[origin.state as "realised" | "broken" | "late"] : undefined;
        make({
          title: `Atlas drafted a${entry.kind === "issue" ? "n" : ""} ${KIND_LABEL[entry.kind].toLowerCase()}: ${entry.title}`,
          why: origin && what ? `the ${KIND_LABEL[origin.kind].toLowerCase()} "${origin.title}" ${what}; confirm it, or drop it` : "confirm it, or drop it",
          source: "Delivery check",
          fromWords: false,
          action: "Confirm",
          group: "today",
          subject,
        });
        break;
      }
      case "confirm_outcome": {
        // OC3: everyone who said it, and what each said
        const said = entry.outcomesProposed.map((o) => `${nameOf(o.by)} says ${OUTCOME_SAID[o.outcome]}`).join("; ");
        make({
          title: `${said}: ${entry.title}`,
          why: `only a PM or Lead ends ${withArticle(KIND_LABEL[entry.kind].toLowerCase())}; decide how it ended, or keep it open`,
          source: `${nameOf(entry.outcomesProposed[0]?.by ?? null)}'s update`,
          fromWords: true,
          action: "Decide",
          group: "today",
          subject,
        });
        break;
      }
      case "dependency_due":
        make({
          title: `Was this delivered? ${entry.title}`,
          why: `it was expected ${entry.expectedOn ? shortDate(entry.expectedOn) : "by now"}; mark it met or late, or give a new date`,
          source: "Delivery check",
          fromWords: false,
          action: "Update",
          group: "today",
          subject,
        });
        break;
      case "clear": {
        const by = nameOf(entry.resolveProposedBy);
        make({
          title: `${by} says this blocker is cleared: ${entry.title}`,
          why: "only the owner of the blocked work, or a PM or Lead, clears a blocker",
          source: `${by}'s update`,
          fromWords: true,
          action: "Confirm",
          group: "today",
          subject,
        });
        break;
      }
    }
  }

  items.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const groups = GROUP_ORDER.map((group) => ({ group, label: GROUP_LABEL[group], items: items.filter((i) => i.group === group) })).filter((g) => g.items.length);
  return { viewerId, items, groups };
}
